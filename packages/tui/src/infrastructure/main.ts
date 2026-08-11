/**
 * PAW TUI
 *
 * @fileoverview Process shell. Load config and plan, run doctor and deterministic
 * herd for read-only views, then run effect-reducer against stdin. Keypress
 * become message. Reducer returns next state and any effects. Shell runs each
 * effect (verb — gates on working tree, daemon verbs over socket, restart shell
 * out to `paw daemon restart`) and feeds result back as message. Two input modes
 * share loop — raw keypress stream on TTY, batch fold over piped input for E2E —
 * snapshot tests exercise the same transitions as keyboard input. Holds no rules and
 * excluded from unit coverage (process I/O, dynamic import); E2E spawns it.
 *
 * @module @paw/tui/infrastructure/main
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
  BUILTIN_ROLES,
  buildRegistry,
  clearBinding,
  dispatchSwarm,
  runDoctor,
  setBinding,
  type ConfigDocumentPort,
  type HealthReport,
  type ModelCapabilities,
  type ModelPort,
  type RoleRegistry,
  type SwarmPlan,
  type Violation,
} from '@paw/core';
import { createNodeConfigDocument, createNodeFileReader, createNodeGateRunner } from '@paw/adapters';
import { rpcCall, socketPath, tokenPath } from '@paw/daemon';
import {
  initialState,
  reduce,
  type ConfigSnapshot,
  type DaemonSnapshot,
  type DaemonStatus,
  type Effect,
  type Msg,
  type TuiData,
  type TuiState,
} from '../domain/app.js';
import { render } from '../domain/screen.js';

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
 * Load and parse JSON config file.
 *
 * @param {string} path - Path to config.
 */
async function loadConfig(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Dynamically import swarm plan, throw if no `default` or `plan` export.
 *
 * @param {string} path - Path to plan module.
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
 * Build registry binding plan's role to deterministic fake model.
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
 * Load everything read-only views render: doctor report and herd.
 *
 * @param {string} configPath - Path to config.
 * @param {string} planPath - Path to plan.
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
 * Working-tree change set: unstaged, staged, untracked files.
 *
 * @param {string} root - Repository root.
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
 * Daemon endpoint and handshake token for repository — same addressing CLI's
 * daemon and violations verbs use.
 *
 * @param {string} root - Repository root.
 * @returns {{ endpoint: string; token: string }} Socket path and token path.
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
 * Read daemon's status and held violations into one snapshot. Either call
 * resolving null (no daemon) yield not-running snapshot.
 *
 * @param {string} root - Repository root.
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
 * Read repo's declared models and every role's binding into snapshot.
 *
 * @param {ConfigDocumentPort} doc - Config document.
 * @returns {Promise<ConfigSnapshot>} Models and bindings.
 */
async function readConfigSnapshot(doc: ConfigDocumentPort): Promise<ConfigSnapshot> {
  const config = await doc.read();
  return {
    models: Object.keys(config.models ?? {}),
    bindings: BUILTIN_ROLES.map((role) => ({
      role: role.id,
      bound: config.roles?.[role.id] ?? null,
    })),
  };
}

/**
 * Run one effect and produce message that carry its result. Gates run project's
 * gates on working-tree changes; daemon actions go over socket; config actions
 * edit bindings on disk. Each resolve to message its view folds.
 *
 * @param {Effect} effect - Effect to run.
 * @param {string} root - Repository root.
 * @returns {Promise<Msg>} Result message.
 */
async function runEffect(effect: Effect, root: string): Promise<Msg> {
  if (effect.kind === 'run-gates') {
    const report: HealthReport = await createNodeGateRunner(root).runForFiles(changedFiles(root));
    return { kind: 'gates', report };
  }
  if (
    effect.kind === 'config-refresh' ||
    effect.kind === 'config-bind' ||
    effect.kind === 'config-unbind'
  ) {
    const doc = createNodeConfigDocument(root);
    if (effect.kind === 'config-bind') {
      const edit = setBinding(await doc.read(), effect.role, effect.model);
      if (edit.ok) {
        await doc.write(edit.config);
      }
    }
    if (effect.kind === 'config-unbind') {
      const edit = clearBinding(await doc.read(), effect.role);
      if (edit.ok) {
        await doc.write(edit.config);
      }
    }
    return { kind: 'config', snapshot: await readConfigSnapshot(doc) };
  }
  if (effect.kind === 'daemon-restart') {
    try {
      execFileSync('paw', ['daemon', 'restart'], { cwd: root, stdio: 'ignore', shell: true });
    } catch {
      // Failed restart just leave snapshot showing not-running.
    }
    return { kind: 'daemon', snapshot: await daemonSnapshot(root) };
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
 * Paint screen to stdout, clear terminal first.
 *
 * @param {TuiState} state - State to render.
 */
function paint(state: TuiState): void {
  process.stdout.write(`\x1b[2J\x1b[H${render(state).lines.join('\n')}\n`);
}

/**
 * Drive effect-reducer with raw-mode keypress loop on TTY.
 *
 * @param {TuiState} start - Initial state.
 * @param {string} root - Repository root.
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
 * Fold reducer over all of piped stdin, run effects between keys, then print
 * final screen once — deterministic path E2E drive.
 *
 * @param {TuiState} start - Initial state.
 * @param {string} root - Repository root.
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
