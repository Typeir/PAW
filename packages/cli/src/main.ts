/**
 * PAW CLI
 *
 * @fileoverview The driving side of the hexagon and the CLI's composition root.
 * Routes a subcommand to a core use-case, loads the config or plan it needs,
 * and prints what the formatters return:
 *
 *   paw check                     read a decision-input on stdin, allow/deny (exit 0/2)
 *   paw hook --copilot "tool.pre" bridge a host hook into the loop (stdin payload
 *                                 -> connector -> handleEvent -> native output)
 *   paw daemon status|stop        inspect or stop this repo's resident pawd
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
 *                                 --sequential one member at a time · --concurrency=N
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

import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, statSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  applyInit,
  buildRegistry,
  composeBrief,
  decidePreToolUse,
  dispatchSwarm,
  doctorPlan,
  runDoctor,
  type InitMode,
  type ModelCapabilities,
  type ModelPort,
  type PreToolInput,
  type RoleRegistry,
  type SwarmPlan,
  type Violation,
} from '@paw/core';
import { createNodeFileReader, createNodeFs } from '@paw/adapters';
import { runHook } from './hook.js';
import { createHerdWriter } from './herdWriter.js';
import {
  attachOutcomeLine,
  attachPromptLines,
  readAttachAnswer,
} from './attachPrompt.js';
import {
  consolePage,
  identityNotice,
  identityPaths,
  markTrusted,
  meterPort,
  nodeIdentityIo,
  nodeRuntime,
  nodeServerIdentity,
  openLiveHerd,
  pawHome,
  lockPath,
  planTrust,
  runDaemon,
  socketPath,
  tokenPath,
  trustCommandLine,
  walkFiles,
  type DaemonHandle,
  type Dispatcher,
} from '@paw/daemon';
import { ensureDaemon, type AutostartSeams } from './autostart.js';
import { startEnforcement } from './pawdStart.js';
import { rpcCall } from './pawdClient.js';
import { formatDaemonStatus, formatDaemonStop } from './daemonStatus.js';
import {
  concurrencyFrom,
  maxTokensFrom,
  parseArgs,
  resolveContext,
  splitPatterns,
  withContext,
} from './context.js';
import { decisionToOutput } from './render.js';
import {
  formatBrief,
  formatDoctor,
  formatHerd,
  formatPlanDoctor,
} from './format.js';

const KNOWN_CONNECTORS = ['copilot-hooks'];

const HOST_FLAGS = ['copilot'];

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
 * Run the `hook` subcommand: a thin client of the resident daemon. The command
 * names the host (a flag) and the event (its value) — e.g.
 * `paw hook --copilot "tool.pre"`. It derives this repository's socket and token
 * from the working directory and hands the round trip to {@link runHook}, which
 * asks pawd to decide and writes the answer — or, with no daemon reachable, the
 * host's do-nothing output. No store, no gates, no per-hook state: the daemon
 * owns all of it (doc 10 §7).
 *
 * @param {string[]} rest - The words after `hook`.
 * @returns {Promise<number>} The exit code (0; the decision rides in the JSON).
 */
async function runHookCommand(rest: string[]): Promise<number> {
  const args = parseArgs(rest, HOST_FLAGS);
  const host = HOST_FLAGS.find((h) => args.values.get(h) !== undefined);
  if (host === undefined) {
    throw new Error('paw hook needs a host and event: paw hook --copilot "tool.pre"');
  }
  const event = args.values.get(host) as string;
  const root = process.cwd();
  const pawDir = resolve(root, '.paw');
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  await ensureDaemon(endpoint, lockPath(pawDir), autostartSeams(root));
  return runHook({
    host,
    event,
    socketPath: endpoint,
    tokenPath: tokenPath(pawDir),
    io: { readStdin, writeStdout: (text) => process.stdout.write(text) },
  });
}

/**
 * Spawn the resident daemon so it does not stay inside the host editor's job.
 *
 * On Windows a hook's detached child is still a member of the editor's job
 * object, so the editor waits on the never-exiting daemon and the spawning hook
 * hangs (the ~18-minute cold-hook hang). `windowsHide` did not cut the tether
 * because the tether is the job, not the console, and Node's `detached` sets
 * `DETACHED_PROCESS`, not `CREATE_BREAKAWAY_FROM_JOB` (which it will not expose).
 * Creating pawd through WMI `Win32_Process.Create` makes it a child of the WMI
 * host instead — outside the editor's job and its pseudo-console — via a
 * short-lived PowerShell launcher that itself exits at once. On posix there is
 * no such tether: a plain detached, unref'd child already outlives the hook, so
 * that path is kept unchanged and never touches WMI.
 *
 * @param {string} root - The project root pawd will serve.
 * @returns {void | Promise<void>} Posix is fire-and-forget; Windows resolves once
 * the short-lived launcher has created pawd, after which the caller polls the socket.
 */
function spawnPawd(root: string): void | Promise<void> {
  const argv = [...process.execArgv, process.argv[1], '__pawd', root];
  if (process.platform !== 'win32') {
    const child = spawn(process.execPath, argv, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return;
  }
  const commandLine = [process.execPath, ...argv].map((part) => `"${part}"`).join(' ');
  const quote = (value: string): string => value.replace(/'/g, "''");
  const script =
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create ` +
    `-Arguments @{CommandLine='${quote(commandLine)}'; CurrentDirectory='${quote(root)}'} | Out-Null`;
  // Pass the script base64-encoded (PowerShell wants UTF-16LE): Node's Windows
  // argument escaping mangles the embedded quotes of a plain -Command string,
  // which silently produced a malformed WMI call that spawned nothing.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  // Await the launcher rather than detach it: it must finish the WMI create
  // before the hook's process.exit(), which would otherwise tear the cold-
  // starting launcher down mid-flight and spawn nothing. The launcher exits at
  // once; pawd, created by the WMI host, is off the editor's job and lives on.
  return new Promise<void>((resolve) => {
    const launcher = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { stdio: 'ignore', windowsHide: true },
    );
    launcher.on('error', () => resolve());
    launcher.on('exit', () => resolve());
  });
}

/**
 * The real autostart effects: probe by opening a connection, take the lock by
 * exclusive create, spawn pawd off the editor's job via {@link spawnPawd}, and
 * sleep with a timer.
 *
 * @param {string} root - The project root pawd would serve.
 * @returns {AutostartSeams} The effects for {@link ensureDaemon}.
 */
function autostartSeams(root: string): AutostartSeams {
  return {
    probe: (sock) =>
      new Promise((res) => {
        const socket = connect(sock);
        const settle = (up: boolean): void => {
          socket.destroy();
          res(up);
        };
        socket.once('connect', () => settle(true));
        socket.once('error', () => settle(false));
        setTimeout(() => settle(false), 500).unref();
      }),
    lockAgeMs: (lp) => {
      try {
        return Date.now() - statSync(lp).mtimeMs;
      } catch {
        return null;
      }
    },
    acquire: (lp) => {
      try {
        closeSync(openSync(lp, 'wx'));
        return true;
      } catch {
        return false;
      }
    },
    release: (lp) => {
      try {
        unlinkSync(lp);
      } catch {
        /* already gone */
      }
    },
    spawn: () => spawnPawd(root),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/**
 * The `__pawd` entry: bring enforcement up for a root and stay resident. This is
 * what autostart spawns; it never returns until the process is killed.
 *
 * @param {string} root - The project root to serve.
 * @returns {Promise<never>} Never resolves.
 */
async function runPawd(root: string): Promise<never> {
  await startEnforcement(root, {
    idle: { ms: 3_600_000, onIdle: () => process.exit(0) },
    control: { pid: process.pid, now: () => Date.now(), onStop: () => process.exit(0) },
  });
  return new Promise<never>(() => undefined);
}

/**
 * Run the `daemon` subcommand: inspect or stop this repository's resident daemon
 * over the socket (doc 10 §12). `status` prints what pawd reports, or that none
 * is running; `stop` asks it to shut down. Both are clients that fail gracefully
 * when no daemon answers — an absent daemon is a state to report, not an error.
 *
 * @param {string[]} rest - The words after `daemon`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<number>} 0 when a daemon answered, 1 when none did.
 */
async function runDaemonCommand(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<number> {
  const sub = rest[0];
  const root = process.cwd();
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  const token = tokenPath(resolve(root, '.paw'));
  if (sub === 'status') {
    const status = await rpcCall(endpoint, token, 'daemon.status', {});
    print(formatDaemonStatus(status as Record<string, unknown> | null));
    return status === null ? 1 : 0;
  }
  if (sub === 'stop') {
    const result = await rpcCall(endpoint, token, 'daemon.stop', {});
    print(formatDaemonStop(result));
    return result === null ? 1 : 0;
  }
  throw new Error(`unknown daemon subcommand "${sub ?? '(none)'}" — try status or stop`);
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

/**
 * Build the dispatcher `paw ui --run` hands the daemon: it releases the herd
 * once against a real model — the deterministic fake, or the live provider under
 * `--live` — through a metered port, so the console's herd and spend meter carry
 * a real run's outcomes and a real token count rather than zeros.
 *
 * @param {boolean} live - Whether to dispatch against the live provider.
 * @returns {Dispatcher} The dispatcher.
 */
function uiDispatcher(
  live: boolean,
  attached: readonly string[],
  concurrency: number | undefined,
  maxOutputTokens: number | undefined,
): Dispatcher {
  return async (plan, onProgress) => {
    const { registry: base, close } = live
      ? await openLiveHerd(plan)
      : { registry: fakeRegistryFor(plan), close: async () => {} };
    try {
      const binding = base.bindings.get(plan.role);
      if (!binding) {
        throw new Error(`cannot run "${plan.name}": role "${plan.role}" is bound to no model`);
      }
      const metered = meterPort(binding.port);
      const bindings = new Map(base.bindings);
      bindings.set(plan.role, { ...binding, port: metered.port });
      const writer = createHerdWriter(plan, createNodeFs(), existsSync);
      const result = await dispatchSwarm(withContext(plan, attached), {
        registry: { declarations: base.declarations, bindings },
        files: createNodeFileReader(process.cwd()),
        concurrency,
        maxOutputTokens,
        onProgress: async (event) => {
          onProgress(event);
          await writer.onProgress(event);
        },
      });
      const wrote = writer.written();
      if (wrote.length > 0) {
        process.stdout.write(`herd wrote ${wrote.length} file(s)
`);
      }
      return { result, usage: metered.usage() };
    } finally {
      await close();
    }
  };
}

/**
 * Ask the operator's terminal to approve a console's attach request, and act on
 * the answer.
 *
 * This is the out-of-band half of the request pattern. The request arrived over
 * the socket; the answer arrives from the keyboard of whoever started the
 * daemon, and the write is performed here — in the process that already holds
 * filesystem authority — rather than by the daemon, which holds none.
 *
 * The outcome is published on the daemon's own bus so the console that asked
 * stops waiting, and an approved attach re-scopes the daemon onto the repository
 * it just configured, so the console sees plans rather than the empty state it
 * asked about.
 *
 * @param {string} path - The repository the console named.
 * @param {InitMode} mode - How it asked for an existing config to be resolved.
 * @param {() => DaemonHandle | null} daemonOf - The running daemon, once it exists.
 * @returns {Promise<void>} Settles when the request has been resolved either way.
 */
async function approveAttach(
  path: string,
  mode: InitMode,
  daemonOf: () => DaemonHandle | null,
): Promise<void> {
  const daemon = daemonOf();
  if (daemon === null) {
    return;
  }
  process.stdout.write(`${attachPromptLines(path, mode).join('\n')}`);

  const answer = await new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.once('line', (line) => {
      resolve(line);
      rl.close();
    });
    rl.once('close', () => resolve(''));
  });

  if (readAttachAnswer(answer) === 'refuse') {
    process.stdout.write(`${attachOutcomeLine(path, [])}\n`);
    daemon.bus.publish('attach', { status: 'refused', path, mode });
    return;
  }

  try {
    const plan = await applyInit(path, createNodeFs(), mode);
    const written = plan.refusal === undefined ? plan.writes.map((w) => w.path) : [];
    process.stdout.write(
      `${attachOutcomeLine(path, written, plan.refusal?.reason)}\n`,
    );
    if (plan.refusal !== undefined) {
      daemon.bus.publish('attach', {
        status: 'refused',
        path,
        mode,
        reason: plan.refusal.reason,
      });
      return;
    }
    await daemon.rescope(path);
    daemon.bus.publish('attach', { status: 'approved', path, mode });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(`attach ${path} failed: ${reason}\n`);
    daemon.bus.publish('attach', { status: 'failed', path, mode, reason });
  }
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
  const args = parseArgs(rest, ['context', 'port', 'root', 'config', 'concurrency', 'max-tokens']);
  const [planPath] = args.positional;
  const live = args.flags.has('live');
  const shouldRun = args.flags.has('run');
  if (shouldRun && planPath === undefined) {
    throw new Error('paw ui --run needs the plan to release: paw ui <plan.swarm.mjs> --run');
  }
  const attached = await resolveContextArg(args.values.get('context'));
  const portValue = args.values.get('port');
  const root = args.values.get('root') ?? '.';
  let handle: DaemonHandle | null = null;
  const daemon = await runDaemon(
    {
      root,
      configPath: args.values.get('config'),
      planPath,
      port: portValue === undefined ? 0 : Number(portValue),
      scopeCeiling: homedir(),
      onAttach: (path, mode) => {
        void approveAttach(path, mode, () => handle);
      },
      ...(shouldRun
        ? { dispatch: uiDispatcher(live, attached, concurrencyFrom(args), maxTokensFrom(args)) }
        : {}),
    },
    nodeRuntime(consolePage()),
  );
  handle = daemon;
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
  if (command === 'hook') {
    return runHookCommand(rest);
  }
  if (command === '__pawd') {
    return runPawd(rest[0] ?? process.cwd());
  }
  if (command === 'daemon') {
    return runDaemonCommand(rest, print);
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
