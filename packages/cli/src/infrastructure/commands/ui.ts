/**
 * PAW CLI — ui command
 *
 * @fileoverview `paw ui [plan.swarm.mjs]`: start pawd in this process, serve
 * console for repository till operator interrupt. Run `--run` dispatcher that
 * meters a real swarm release; attach approval: console request over socket,
 * operator answer here.
 *
 * @module @paw/cli/infrastructure/commands/ui
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import {
  applyInit,
  dispatchSwarm,
  pawHome,
  type InitMode,
  type RunSettings,
  type SwarmPlan,
} from '@paw/core';
import {
  createNodeConfigDocument,
  createNodeFileReader,
  createNodeFs,
  createNodeRecentRoutes,
} from '@paw/adapters';
import {
  configControl,
  consolePage,
  COPILOT_SLIM_SECTIONS,
  dispatcherFor,
  enforcementControl,
  identityNotice,
  mergeControl,
  meterPort,
  nodeRuntime,
  openLiveHerd,
  runDaemon,
  type DaemonHandle,
  type Dispatcher,
} from '@paw/daemon';
import {
  attachOutcomeLine,
  attachPromptLines,
  readAttachAnswer,
} from '../../domain/attachPrompt.js';
import { createHerdWriter } from '../../application/herdWriter.js';
import { concurrencyFrom, maxTokensFrom, parseArgs, withContext } from '../../domain/context.js';
import { fakeRegistryFor, resolveContextArg } from './swarm.js';

/**
 * Build dispatcher for `paw ui --run`. Release the swarm once against the real
 * model — deterministic fake, or live provider under `--live` — through metered
 * port. Console and meter record run outcomes and token count.
 *
 * @param {boolean} live - Dispatch against live provider or not.
 * @param {boolean} full - Live only: keep model stock persona, not slim baseline.
 * @param {readonly string[]} attached - Files attach to every brief.
 * @param {number | undefined} concurrency - Max members in flight.
 * @param {number | undefined} maxOutputTokens - Per-member output cap.
 * @returns {Dispatcher} The dispatcher.
 */
function uiDispatcher(
  live: boolean,
  full: boolean,
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
      const writer = live ? null : createHerdWriter(plan, createNodeFs(), existsSync);
      const result = await dispatchSwarm(withContext(plan, attached), {
        registry: { declarations: base.declarations, bindings },
        files: createNodeFileReader(process.cwd()),
        concurrency,
        maxOutputTokens,
        systemBaseline: live && !full ? COPILOT_SLIM_SECTIONS : undefined,
        onProgress: async (event) => {
          onProgress(event);
          await writer?.onProgress(event);
        },
      });
      const wrote = writer?.written() ?? [];
      if (wrote.length > 0) {
        process.stdout.write(`herd wrote ${wrote.length} file(s)\n`);
      }
      return { result, usage: metered.usage() };
    } finally {
      await close();
    }
  };
}

/**
 * Launch default browser at console URL — the OS opener per platform, detached
 * so the daemon never wait on it.
 *
 * @param {string} url - Console URL, token included.
 */
function openBrowser(url: string): void {
  const [cmd, cmdArgs]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
}

/**
 * Build dispatcher for approved console release: live registry or fake, slim
 * persona on live, herd writer on fake only (live members edit in place),
 * context globs resolved against the repo the CLI runs in.
 *
 * @param {RunSettings} settings - What console asked to run.
 * @returns {Dispatcher} Dispatcher the daemon run and meter.
 */
function releaseDispatcher(settings: RunSettings): Dispatcher {
  return dispatcherFor(settings, {
    openLive: (plan: SwarmPlan<unknown>) => openLiveHerd(plan),
    fakeRegistry: fakeRegistryFor,
    withContext,
    resolveContext: (globs) => resolveContextArg(globs.join(',')),
    files: createNodeFileReader(process.cwd()),
    makeWriter: (plan) =>
      settings.live
        ? { onProgress: async () => undefined, written: () => [] }
        : createHerdWriter(plan, createNodeFs(), existsSync),
    dispatch: (plan, deps) =>
      dispatchSwarm(plan, {
        ...deps,
        ...(settings.live ? { systemBaseline: COPILOT_SLIM_SECTIONS } : {}),
      }),
  });
}

/**
 * Ask operator terminal to approve console release request; approved one run
 * through the daemon so console shows the result. Out-of-band half of the
 * request,
 * same pattern as attach: request over socket, answer from keyboard of whoever
 * run pawd. A live release spends real tokens; release only after the operator
 * answers yes.
 *
 * @param {RunSettings} settings - What console asked to run.
 * @param {() => DaemonHandle | null} daemonOf - Running daemon, once exist.
 * @returns {Promise<void>} Settle once request resolve.
 */
async function approveRelease(
  settings: RunSettings,
  daemonOf: () => DaemonHandle | null,
): Promise<void> {
  const daemon = daemonOf();
  if (daemon === null) {
    return;
  }
  const globs = settings.context?.length ?? 0;
  process.stdout.write(
    `\nconsole asks to release ${settings.plan} · ${
      settings.live ? 'LIVE model — this spends' : 'fake model'
    }${globs > 0 ? ` · ${globs} context glob(s)` : ''}\ntype y to release · anything else refuses\n`,
  );
  const answer = await new Promise<string>((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin });
    rl.once('line', (line) => {
      resolveAnswer(line);
      rl.close();
    });
    rl.once('close', () => resolveAnswer(''));
  });
  if (answer.trim().toLowerCase() !== 'y') {
    process.stdout.write(`release of ${settings.plan} refused\n`);
    return;
  }
  try {
    await daemon.release(settings);
    process.stdout.write(`release of ${settings.plan} finished\n`);
  } catch (err: unknown) {
    process.stderr.write(
      `release of ${settings.plan} failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/**
 * Ask operator terminal to approve console attach request and act on answer.
 * Out-of-band half of request pattern: request come over socket; answer come
 * from keyboard of whoever start daemon. Write happen here, in process that own
 * filesystem access.
 *
 * @param {string} path - Repository console name.
 * @param {InitMode} mode - How existing config resolve.
 * @param {() => DaemonHandle | null} daemonOf - Running daemon, once exist.
 * @returns {Promise<void>} Settle once request resolve.
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
    process.stdout.write(`${attachOutcomeLine(path, written, plan.refusal?.reason)}\n`);
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
 * Run `ui` subcommand. Start pawd in this process, serve console for repository
 * till operator interrupt.
 *
 * @param {string[]} rest - Words after `ui`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<never>} Never resolve; command serve till interrupt.
 */
export async function runUi(
  rest: string[],
  print: (lines: string[]) => void,
): Promise<never> {
  const args = parseArgs(rest, ['context', 'port', 'root', 'config', 'concurrency', 'max-tokens']);
  const [planPath] = args.positional;
  const live = args.flags.has('live');
  const full = args.flags.has('full');
  const shouldRun = args.flags.has('run');
  if (shouldRun && planPath === undefined) {
    throw new Error('paw ui --run needs the plan to release: paw ui <plan.swarm.mjs> --run');
  }
  const attached = await resolveContextArg(args.values.get('context'));
  const portValue = args.values.get('port');
  const root = resolve(args.values.get('root') ?? '.');
  let handle: DaemonHandle | null = null;
  const scope = (): string => handle?.root ?? root;
  const control = args.flags.has('control')
    ? mergeControl(enforcementControl(scope), configControl(createNodeConfigDocument(scope)))
    : undefined;
  const daemon = await runDaemon(
    {
      root,
      configPath: args.values.get('config'),
      planPath,
      port: portValue === undefined ? 0 : Number(portValue),
      scopeCeiling: homedir(),
      recent: createNodeRecentRoutes(pawHome(process.platform, process.env)),
      onAttach: (path, mode) => {
        void approveAttach(path, mode, () => handle);
      },
      onRelease: (settings) => {
        void approveRelease(settings, () => handle);
      },
      dispatcherFor: releaseDispatcher,
      ...(control ? { control } : {}),
      ...(shouldRun
        ? { dispatch: uiDispatcher(live, full, attached, concurrencyFrom(args), maxTokensFrom(args)) }
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
    control
      ? 'control enabled · the console may edit bindings, prune violations, and stop enforcement'
      : 'observational · pass --control to let the console write',
    args.flags.has('open')
      ? 'opening the console in your browser'
      : 'open that URL for the console · ctrl-c to stop · pass --open to launch it',
  ]);
  if (args.flags.has('open')) {
    openBrowser(`${daemon.url}#t=${daemon.token}`);
  }
  daemon.dispatched?.catch((err: unknown) => {
    process.stderr.write(
      `run failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
  return new Promise<never>(() => undefined);
}
