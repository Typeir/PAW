/**
 * PAW CLI — swarm command
 *
 * @fileoverview `paw swarm doctor|show|run`: validate a plan, print a member's
 * rendered brief, or dispatch the plan against the deterministic fake model (or
 * the live provider under `--live`). Also home to the herd helpers the `ui`
 * command shares — plan loading, `--context` expansion, and the fake registry.
 *
 * @module @paw/cli/commands/swarm
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildRegistry,
  composeBrief,
  dispatchSwarm,
  doctorPlan,
  type ModelCapabilities,
  type ModelPort,
  type RoleRegistry,
  type SwarmPlan,
} from '@paw/core';
import { createNodeFileReader, createNodeFs } from '@paw/adapters';
import { openLiveHerd, walkFiles } from '@paw/daemon';
import { createHerdWriter } from '../herdWriter.js';
import {
  concurrencyFrom,
  maxTokensFrom,
  parseArgs,
  resolveContext,
  splitPatterns,
  withContext,
} from '../context.js';
import { formatBrief, formatHerd, formatPlanDoctor } from '../format.js';

/**
 * The capabilities a fake or noop model advertises — everything on, cost trivial.
 */
export const FULL_CAPS: ModelCapabilities = {
  contextTokens: 200_000,
  maxOutputTokens: 32_000,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: true,
  costClass: 'trivial',
};

/**
 * Dynamically import a swarm plan module, failing loud when it does not export one.
 *
 * @param {string} path - Path to the `.swarm.mjs` plan.
 * @returns {Promise<SwarmPlan<unknown>>} The plan.
 */
export async function loadPlan(path: string): Promise<SwarmPlan<unknown>> {
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
 * Expand a `--context` value against the repository the CLI is standing in. The
 * walk is the daemon's own, so the files a glob can reach here are exactly the
 * files the console's selector can offer, and neither can reach outside the repo.
 *
 * @param {string | undefined} value - The raw `--context` value, if given.
 * @returns {Promise<string[]>} The resolved paths.
 */
export async function resolveContextArg(value: string | undefined): Promise<string[]> {
  const patterns = splitPatterns(value);
  if (patterns.length === 0) {
    return [];
  }
  const listing = await walkFiles(process.cwd());
  return resolveContext(
    patterns,
    listing.filter((entry) => entry.isFile).map((entry) => entry.path),
  );
}

/**
 * Build a registry that binds a plan's role to a deterministic fake model.
 *
 * @param {SwarmPlan<unknown>} plan - The plan being run.
 * @returns {RoleRegistry} The registry.
 */
export function fakeRegistryFor(plan: SwarmPlan<unknown>): RoleRegistry {
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
 * Run a `swarm` subcommand.
 *
 * @param {string[]} rest - The words after `swarm`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} The exit code: 0 when ok, 1 when the plan is refused.
 */
export async function runSwarm(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const args = parseArgs(rest, ['context', 'concurrency', 'max-tokens']);
  const live = args.flags.has('live');
  const [sub, planPath, memberArg] = args.positional;
  const plan = await loadPlan(planPath);
  if (sub === 'doctor') {
    const findings = doctorPlan(plan);
    print(formatPlanDoctor(plan.name, findings));
    return findings.every((f) => f.ok) ? 0 : 1;
  }
  if (sub === 'show') {
    const attached = await resolveContextArg(args.values.get('context'));
    const member = Number(memberArg);
    const prompt = await composeBrief(
      withContext(plan, attached),
      member,
      createNodeFileReader(process.cwd()),
    );
    print(formatBrief(plan, member, prompt));
    return 0;
  }
  if (sub === 'run') {
    const attached = await resolveContextArg(args.values.get('context'));
    if (attached.length > 0) {
      print([`attaching ${attached.length} file(s) to every brief: ${attached.join(', ')}`]);
    }
    const { registry, close } = live
      ? await openLiveHerd(plan)
      : { registry: fakeRegistryFor(plan), close: async () => {} };
    try {
      const writer = createHerdWriter(plan, createNodeFs(), existsSync);
      const result = await dispatchSwarm(withContext(plan, attached), {
        registry,
        files: createNodeFileReader(process.cwd()),
        concurrency: concurrencyFrom(args),
        maxOutputTokens: maxTokensFrom(args),
        onProgress: (event) => writer.onProgress(event),
      });
      print(formatHerd(result));
      const wrote = writer.written();
      print([
        wrote.length === 0
          ? 'wrote nothing — the plan declares no expectFiles'
          : `wrote ${wrote.length} file(s), first ${wrote[0]}`,
      ]);
      return result.released ? 0 : 1;
    } finally {
      await close();
    }
  }
  throw new Error(`unknown swarm subcommand "${sub ?? '(none)'}"`);
}
