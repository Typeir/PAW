/**
 * PAW TUI
 *
 * @fileoverview The process shell: it loads a config and a plan, runs the doctor
 * and a deterministic herd for the read-only views, then drives the effect-
 * reducer against stdin. A keypress becomes a message; the reducer returns the
 * next state and any effects; the shell runs each effect (a verb — gates first)
 * and feeds the result back as a message. Two input modes share the loop — a raw
 * keypress stream on a TTY, and a batch fold over piped input for the E2E — so a
 * snapshot test drives the same transitions a person does. Holds no rules and is
 * excluded from unit coverage (process I/O, dynamic import); the E2E spawns it.
 *
 * @module @paw/tui/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildRegistry,
  dispatchSwarm,
  runDoctor,
  type HealthReport,
  type ModelCapabilities,
  type ModelPort,
  type RoleRegistry,
  type SwarmPlan,
  type Violation,
} from '@paw/core';
import { createNodeFileReader, createNodeGateRunner } from '@paw/adapters';
import { rpcCall, socketPath, tokenPath } from '@paw/daemon';
import {
  initialState,
  reduce,
  type DaemonSnapshot,
  type DaemonStatus,
  type Effect,
  type Msg,
  type TuiData,
  type TuiState,
} from './app.js';
import { render } from './screen.js';

const KNOWN_CONNECTORS = ['copilot-hooks'];

const NOOP_PORT: ModelPort = {
  complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }),
};

const FULL_CAPS: ModelCapabilities = {
  contextTokens: 200_000,
  maxOutputTokens: 32_000,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: true,
  costClass: 'trivial',
};

/**
 * Load and parse a JSON config file.
 *
 * @param {string} path - Path to the config.
 */
async function loadConfig(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Dynamically import a swarm plan, failing loud when it exports none.
 *
 * @param {string} path - Path to the plan module.
 */
async function loadPlan(path: string): Promise<SwarmPlan<unknown>> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as {
    default?: SwarmPlan<unknown>;
    plan?: SwarmPlan<unknown>;
  };
  const plan = mod.default ?? mod.plan;
  if (!plan || typeof plan.brief !== 'function') {
    throw new Error(`"${path}" does not export a swarm plan`);
  }
  return plan;
}

/**
 * Build a registry binding the plan's role to a deterministic fake model.
 *
 * @param {SwarmPlan<unknown>} plan - The plan being run.
 */
function fakeRegistryFor(plan: SwarmPlan<unknown>): RoleRegistry {
  const model: ModelPort = {
    complete: async (req) => ({
      content: `ran: ${req.prompt.split('\n')[0]}`,
      inputTokens: req.prompt.length,
      outputTokens: 1,
    }),
  };
  return buildRegistry(
    { models: { fake: FULL_CAPS }, roles: { [plan.role]: 'fake' } },
    () => model,
  );
}

/**
 * Load everything the read-only views render: the doctor report and a herd.
 *
 * @param {string} configPath - Path to the config.
 * @param {string} planPath - Path to the plan.
 */
async function loadData(configPath: string, planPath: string): Promise<TuiData> {
  const config = await loadConfig(configPath);
  const plan = await loadPlan(planPath);
  const doctor = runDoctor(
    config,
    buildRegistry(config, () => NOOP_PORT),
    KNOWN_CONNECTORS,
  );
  const herd = await dispatchSwarm(plan, {
    registry: fakeRegistryFor(plan),
    files: createNodeFileReader(process.cwd()),
  });
  return { doctor, plan, herd };
}

/**
 * The working-tree change set: unstaged, staged, and untracked files.
 *
 * @param {string} root - The repository root.
 * @returns {string[]} Deduped, slash-normalised paths.
 */
function changedFiles(root: string): string[] {
  const git = (args: string[]): string[] => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim().replace(/\\/g, '/'))
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  };
  return [
    ...new Set([
      ...git(['diff', '--name-only', 'HEAD']),
      ...git(['diff', '--cached', '--name-only']),
      ...git(['ls-files', '--others', '--exclude-standard']),
    ]),
  ];
}

/**
 * The daemon endpoint and handshake token for this repository — the same
 * addressing the CLI's daemon and violations verbs use.
 *
 * @param {string} root - The repository root.
 * @returns {{ endpoint: string; token: string }} The socket path and token path.
 */
function daemonEndpoint(root: string): { endpoint: string; token: string } {
  return {
    endpoint: socketPath(root, {
      platform: process.platform,
      xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
      tmpdir: tmpdir(),
    }),
    token: tokenPath(resolve(root, '.paw')),
  };
}

/**
 * Read the daemon's status and the violations it holds into one snapshot. Either
 * call resolving null (no daemon) yields a not-running snapshot.
 *
 * @param {string} root - The repository root.
 * @returns {Promise<DaemonSnapshot>} The snapshot.
 */
async function daemonSnapshot(root: string): Promise<DaemonSnapshot> {
  const { endpoint, token } = daemonEndpoint(root);
  const status = (await rpcCall(endpoint, token, 'daemon.status', {})) as DaemonStatus | null;
  const listed = (await rpcCall(endpoint, token, 'violations.list', {})) as
    | { violations?: Violation[] }
    | null;
  return { status, violations: listed?.violations ?? [] };
}

/**
 * Run one effect and produce the message that carries its result. Gates run the
 * project's gates on the working-tree changes; the daemon actions go over the
 * socket, each resolving to a fresh {@link DaemonSnapshot}.
 *
 * @param {Effect} effect - The effect to run.
 * @param {string} root - The repository root.
 * @returns {Promise<Msg>} The result message.
 */
async function runEffect(effect: Effect, root: string): Promise<Msg> {
  if (effect.kind === 'run-gates') {
    const report: HealthReport = await createNodeGateRunner(root).runForFiles(changedFiles(root));
    return { kind: 'gates', report };
  }
  const { endpoint, token } = daemonEndpoint(root);
  if (effect.kind === 'daemon-stop') {
    await rpcCall(endpoint, token, 'daemon.stop', {});
    return { kind: 'daemon', snapshot: { status: null, violations: [] } };
  }
  if (effect.kind === 'daemon-prune') {
    await rpcCall(endpoint, token, 'violations.prune', {});
  }
  return { kind: 'daemon', snapshot: await daemonSnapshot(root) };
}

/**
 * Paint a screen to stdout, clearing the terminal first.
 *
 * @param {TuiState} state - The state to render.
 */
function paint(state: TuiState): void {
  process.stdout.write(`\x1b[2J\x1b[H${render(state).lines.join('\n')}\n`);
}

/**
 * Drive the effect-reducer with a raw-mode keypress loop on a TTY.
 *
 * @param {TuiState} start - The initial state.
 * @param {string} root - The repository root.
 */
function runInteractive(start: TuiState, root: string): void {
  let state = start;
  const dispatch = async (msg: Msg): Promise<void> => {
    const step = reduce(state, msg);
    state = step.state;
    paint(state);
    if (state.quit) {
      process.stdin.setRawMode?.(false);
      process.exit(0);
    }
    for (const effect of step.effects) {
      await dispatch(await runEffect(effect, root));
    }
  };
  paint(state);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const key of chunk) {
      void dispatch({ kind: 'key', key });
    }
  });
}

/**
 * Fold the reducer over all of piped stdin, running effects between keys, then
 * print the final screen once — the deterministic path the E2E drives.
 *
 * @param {TuiState} start - The initial state.
 * @param {string} root - The repository root.
 */
async function runBatch(start: TuiState, root: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  let state = start;
  const dispatch = async (msg: Msg): Promise<void> => {
    const step = reduce(state, msg);
    state = step.state;
    for (const effect of step.effects) {
      await dispatch(await runEffect(effect, root));
    }
  };
  for (const key of Buffer.concat(chunks).toString('utf8')) {
    await dispatch({ kind: 'key', key });
  }
  process.stdout.write(`${render(state).lines.join('\n')}\n`);
}

/**
 * TUI entrypoint.
 */
async function main(): Promise<void> {
  const [configPath, planPath] = process.argv.slice(2);
  if (!configPath || !planPath) {
    throw new Error('usage: paw-tui <config.json> <plan.mjs>');
  }
  const state = initialState(await loadData(configPath, planPath));
  const root = process.cwd();
  if (process.stdin.isTTY) {
    runInteractive(state, root);
  } else {
    await runBatch(state, root);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
