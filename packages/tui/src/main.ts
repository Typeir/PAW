/**
 * PAW TUI
 *
 * @fileoverview The driving side of the hexagon: the process shell that loads a
 * config and a plan, runs the doctor and a deterministic herd for the views to
 * render, then drives the pure {@link reduce}/{@link render} loop against stdin.
 * Two input modes share one reducer — a raw-mode keypress loop on a TTY, and a
 * batch fold over piped input for the E2E — so the same transitions a snapshot
 * test proves are the ones a person drives. Holds no rules and is excluded from
 * unit coverage (process I/O, dynamic import); the E2E spawns it. Fails loud: a
 * bad command or a plan-less module exits non-zero.
 *
 * @module @paw/tui/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildRegistry,
  dispatchSwarm,
  runDoctor,
  type ModelCapabilities,
  type ModelPort,
  type RoleRegistry,
  type SwarmPlan,
} from '@paw/core';
import { createNodeFileReader } from '@paw/adapters';
import { initialState, reduce, type TuiData, type TuiState } from './app.js';
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
 * Load everything the views render: the doctor report and a released herd.
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
 * Paint a screen to stdout, clearing the terminal first.
 *
 * @param {TuiState} state - The state to render.
 */
function paint(state: TuiState): void {
  process.stdout.write(`\x1b[2J\x1b[H${render(state).lines.join('\n')}\n`);
}

/**
 * Drive the reducer with a raw-mode keypress loop on a TTY.
 *
 * @param {TuiState} start - The initial state.
 */
function runInteractive(start: TuiState): void {
  let state = start;
  paint(state);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const key of chunk) {
      state = reduce(state, key);
    }
    if (state.quit) {
      process.stdin.setRawMode?.(false);
      process.exit(0);
    }
    paint(state);
  });
}

/**
 * Fold the reducer over all of piped stdin, then print the final screen once —
 * the deterministic path the E2E drives.
 *
 * @param {TuiState} start - The initial state.
 */
async function runBatch(start: TuiState): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  let state = start;
  for (const key of Buffer.concat(chunks).toString('utf8')) {
    state = reduce(state, key);
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
  if (process.stdin.isTTY) {
    runInteractive(state);
  } else {
    await runBatch(state);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
