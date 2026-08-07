/**
 * PAW CLI
 *
 * @fileoverview The driving side of the hexagon and the CLI's composition root.
 * Routes a subcommand to a core use-case, loads the config or plan it needs,
 * and prints what the formatters return:
 *
 *   paw check                     read a decision-input on stdin, allow/deny (exit 0/2)
 *   paw doctor <config.json>      validate config + role bindings
 *   paw swarm doctor <plan.mjs>   validate a swarm plan
 *   paw swarm show <plan> <n>     print member n's rendered brief
 *   paw swarm run <plan.mjs>      dispatch the plan (fake model — deterministic)
 *                                 (--context a.ts,src/** attaches files to every brief)
 *   paw ui [plan.swarm.mjs]       serve this repository's console (the plan is optional —
 *                                 the console picks between every plan it discovers)
 *                                 --root=DIR serve another repo · --config=PATH override
 *                                 --run release the named plan · --live use the provider
 *                                 --context a,b attach files to every brief
 *   paw trust [--dry-run]         install this machine's PAW CA so the console
 *                                 loads without a certificate warning
 *
 * Holds no rules. Excluded from unit coverage (process I/O, dynamic import) and
 * exercised by the E2E, which spawns it. Fails loud: an unknown command or a
 * malformed input exits non-zero with a message.
 *
 * @module @paw/cli/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildRegistry,
  composeBrief,
  decidePreToolUse,
  dispatchSwarm,
  doctorPlan,
  runDoctor,
  type ModelCapabilities,
  type ModelPort,
  type PreToolInput,
  type RoleRegistry,
  type SwarmPlan,
  type Violation,
} from '@paw/core';
import { createNodeFileReader } from '@paw/adapters';
import {
  identityNotice,
  identityPaths,
  markTrusted,
  meterPort,
  nodeIdentityIo,
  nodeRuntime,
  nodeServerIdentity,
  pawHome,
  planTrust,
  runDaemon,
  trustCommandLine,
  walkFiles,
  type Dispatcher,
} from '@paw/daemon';
import {
  parseArgs,
  resolveContext,
  splitPatterns,
  withContext,
} from './context.js';
import { loadEnvLocal, liveRegistryFor } from './deepseekRuntime.js';
import { decisionToOutput } from './render.js';
import {
  formatBrief,
  formatDoctor,
  formatHerd,
  formatPlanDoctor,
} from './format.js';

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
 * Read all of stdin as text.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Load and parse a JSON config file.
 *
 * @param {string} path - Path to the config.
 */
async function loadConfig(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Dynamically import a swarm plan module, failing loud when it does not export one.
 *
 * @param {string} path - Path to the `.swarm.mjs` plan.
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
 * Expand a `--context` value against the repository the CLI is standing in. The
 * walk is the daemon's own — the same listing `/api/tree` is built from — so the
 * files a glob can reach here are exactly the files the console's selector can
 * offer, and neither can reach outside the repository.
 *
 * @param {string | undefined} value - The raw `--context` value, if given.
 * @returns {Promise<string[]>} The resolved paths.
 */
async function resolveContextArg(value: string | undefined): Promise<string[]> {
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
 * Run the `check` subcommand: a stdin enforcement decision.
 */
async function runCheck(): Promise<never> {
  const wire = JSON.parse(await readStdin()) as {
    toolName: string;
    targetPaths?: string[];
    envMatch?: string | null;
    exemptTools?: string[];
    ignoredPaths?: string[];
    violations?: Violation[];
  };
  const input: PreToolInput = {
    toolName: wire.toolName,
    targetPaths: wire.targetPaths ?? [],
    envMatch: wire.envMatch ?? null,
    exemptTools: new Set(wire.exemptTools ?? []),
    ignoredPaths: new Set(wire.ignoredPaths ?? []),
    violations: wire.violations ?? [],
  };
  const out = decisionToOutput(decidePreToolUse(input));
  process.stdout.write(`${out.text}\n`);
  process.exit(out.exitCode);
}

/**
 * Run a `swarm` subcommand.
 *
 * @param {string[]} rest - The words after `swarm`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} The exit code: 0 when ok, 1 when the plan is refused.
 */
async function runSwarm(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const args = parseArgs(rest, ['context']);
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
    if (live) {
      await loadEnvLocal(process.cwd());
    }
    const attached = await resolveContextArg(args.values.get('context'));
    if (attached.length > 0) {
      print([`attaching ${attached.length} file(s) to every brief: ${attached.join(', ')}`]);
    }
    const registry = live ? liveRegistryFor(plan) : fakeRegistryFor(plan);
    const result = await dispatchSwarm(withContext(plan, attached), {
      registry,
      files: createNodeFileReader(process.cwd()),
    });
    print(formatHerd(result));
    return result.released ? 0 : 1;
  }
  throw new Error(`unknown swarm subcommand "${sub ?? '(none)'}"`);
}

/**
 * Build the dispatcher `paw ui --run` hands the daemon: it releases the herd
 * once against a real model — the deterministic fake, or the live provider under
 * `--live` — through a metered port, so the console's herd and spend meter carry
 * a real run's outcomes and a real token count rather than zeros.
 *
 * @param {boolean} live - Whether to dispatch against the live provider.
 * @returns {Dispatcher} The dispatcher.
 */
function uiDispatcher(live: boolean, attached: readonly string[]): Dispatcher {
  return async (plan, onProgress) => {
    const base = live ? liveRegistryFor(plan) : fakeRegistryFor(plan);
    const binding = base.bindings.get(plan.role);
    if (!binding) {
      throw new Error(`cannot run "${plan.name}": role "${plan.role}" is bound to no model`);
    }
    const metered = meterPort(binding.port);
    const bindings = new Map(base.bindings);
    bindings.set(plan.role, { ...binding, port: metered.port });
    const result = await dispatchSwarm(withContext(plan, attached), {
      registry: { declarations: base.declarations, bindings },
      files: createNodeFileReader(process.cwd()),
      // Straight through to the daemon's bus: the console fills in member by
      // member instead of staying blank until the whole herd has landed.
      onProgress,
    });
    return { result, usage: metered.usage() };
  };
}

/**
 * Run the `ui` subcommand: start `pawd` in this process and serve the console
 * for a **repository** until the operator interrupts it. No plan is required —
 * the daemon discovers every `*.swarm.mjs` and the console picks between them,
 * so one console covers a workspace rather than one console per swarm. Naming a
 * plan opens on it, which is also what `--run` releases. The daemon runs
 * in-process rather than as a spawned child, so there is one process to kill and
 * one place a failure can surface.
 *
 * @param {string[]} rest - The words after `ui`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<never>} Never resolves; the command serves until interrupted.
 */
async function runUi(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<never> {
  const args = parseArgs(rest, ['context', 'port', 'root', 'config']);
  const [planPath] = args.positional;
  const live = args.flags.has('live');
  const shouldRun = args.flags.has('run');
  if (shouldRun && planPath === undefined) {
    throw new Error('paw ui --run needs the plan to release: paw ui <plan.swarm.mjs> --run');
  }
  if (live) {
    await loadEnvLocal(process.cwd());
  }
  const attached = await resolveContextArg(args.values.get('context'));
  const portValue = args.values.get('port');
  const root = args.values.get('root') ?? '.';
  const daemon = await runDaemon(
    {
      root,
      configPath: args.values.get('config'),
      planPath,
      port: portValue === undefined ? 0 : Number(portValue),
      ...(shouldRun ? { dispatch: uiDispatcher(live, attached) } : {}),
    },
    nodeRuntime(),
  );
  print([
    `pawd listening on ${daemon.url}#t=${daemon.token}`,
    'that URL carries this session’s credential — treat it like a password',
    ...identityNotice(daemon.identity, new Date()),
    `repo ${root} · ${daemon.plans.length} plan(s)${
      daemon.openedOn === null ? ' · pick one in the console' : ` · open on ${daemon.openedOn}`
    }`,
    attached.length > 0
      ? `attaching ${attached.length} file(s) to every brief: ${attached.join(', ')}`
      : 'no files attached · pass --context a,b or pick them in the console',
    shouldRun
      ? `releasing the herd (${live ? 'live' : 'fake'} model) · the console fills in as it lands`
      : 'no run released · pass --run to dispatch',
    'open that URL for the console · ctrl-c to stop',
  ]);
  daemon.dispatched?.catch((err: unknown) => {
    process.stderr.write(
      `run failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
  return new Promise<never>(() => undefined);
}

/**
 * Install this machine's PAW CA into a trust store, so the console loads without
 * a browser warning.
 *
 * The design constraint is that the operator must be able to see the whole thing
 * before consenting to any of it: `--dry-run` prints the exact commands and the
 * fingerprint, and the fingerprint is printed either way so it can be compared
 * against whatever dialog the OS raises. A step that fails is reported with the
 * command that failed and the run stops — the identity is only marked trusted
 * once every step actually succeeded, because a flag set on intent would silence
 * the warning while the browser kept refusing.
 *
 * @param {string[]} rest - The words after `trust`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} The exit code.
 */
async function runTrust(rest: string[], print: (lines: string[]) => void): Promise<number> {
  const dryRun = rest.includes('--dry-run');
  const platform = process.platform;
  const identity = await nodeServerIdentity(process.env, platform, new Date());
  const plan = planTrust(platform, identity.caCertPath, homedir());

  print([
    `PAW local CA · ${identity.meta.caFingerprint}`,
    `  certificate: ${identity.caCertPath}`,
    '  the OS dialog must show that exact fingerprint — refuse it if it does not',
    '',
    ...plan.steps.map((step) => `  ${step.describe}\n    ${trustCommandLine(step)}`),
    ...(plan.manual.length === 0 ? [] : ['', ...plan.manual]),
  ]);

  if (dryRun) {
    print(['', 'dry run · nothing was changed']);
    return 0;
  }
  if (identity.meta.trusted) {
    print(['', 'already recorded as trusted · re-running the steps above anyway']);
  }

  for (const step of plan.steps) {
    const result = await runCommand(step.command, step.args);
    if (result.code !== 0) {
      process.stderr.write(
        `trust failed: ${trustCommandLine(step)}\n` +
          `  exit ${result.code}\n${result.output.replace(/^/gm, '  ')}\n`,
      );
      return 1;
    }
  }

  await markTrusted(
    identityPaths(pawHome(platform, process.env)),
    nodeIdentityIo(platform),
    true,
  );
  print(['', 'trusted · restart the browser tab for it to take effect']);
  return 0;
}

/**
 * Run a program to completion, capturing what it said.
 *
 * @param {string} command - The program.
 * @param {readonly string[]} args - Its arguments.
 * @returns {Promise<{ code: number; output: string }>} The exit code and its combined output.
 */
function runCommand(
  command: string,
  args: readonly string[],
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(command, [...args], { windowsHide: true }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      if (err === null) {
        resolve({ code: 0, output });
        return;
      }
      const code = typeof err.code === 'number' ? err.code : 1;
      resolve({ code: code === 0 ? 1 : code, output: output === '' ? err.message : output });
    });
  });
}

/**
 * CLI entrypoint.
 *
 * @returns {Promise<number>} The exit code for the routed command.
 */
async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const print = (lines: string[]): void => {
    process.stdout.write(`${lines.join('\n')}\n`);
  };

  if (command === 'check') {
    await runCheck();
    return 0;
  }
  if (command === 'doctor') {
    const config = await loadConfig(rest[0]);
    const registry = buildRegistry(config, () => NOOP_PORT);
    const report = runDoctor(config, registry, KNOWN_CONNECTORS);
    print(formatDoctor(report));
    return report.ok ? 0 : 1;
  }
  if (command === 'swarm') {
    return runSwarm(rest, print);
  }
  if (command === 'ui') {
    return runUi(rest, print);
  }
  if (command === 'trust') {
    return runTrust(rest, print);
  }
  throw new Error(`unknown command "${command ?? '(none)'}"`);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
