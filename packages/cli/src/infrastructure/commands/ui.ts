/**
 * PAW CLI — ui command
 *
 * @fileoverview `paw ui [plan.swarm.mjs]`: start pawd in this process and serve
 * the console for a repository until the operator interrupts it. Holds the
 * `--run` dispatcher that meters a real herd release, and the out-of-band attach
 * approval the console requests over the socket and the operator answers here.
 *
 * @module @paw/cli/infrastructure/commands/ui
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { applyInit, dispatchSwarm, type InitMode } from '@paw/core';
import { createNodeConfigDocument, createNodeFileReader, createNodeFs } from '@paw/adapters';
import {
  configControl,
  consolePage,
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
 * Build the dispatcher `paw ui --run` hands the daemon: it releases the herd once
 * against a real model — the deterministic fake, or the live provider under
 * `--live` — through a metered port, so the console's herd and spend meter carry
 * a real run's outcomes and a real token count rather than zeros.
 *
 * @param {boolean} live - Whether to dispatch against the live provider.
 * @param {readonly string[]} attached - Files attached to every brief.
 * @param {number | undefined} concurrency - Max members in flight.
 * @param {number | undefined} maxOutputTokens - Per-member output cap.
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
        process.stdout.write(`herd wrote ${wrote.length} file(s)\n`);
      }
      return { result, usage: metered.usage() };
    } finally {
      await close();
    }
  };
}

/**
 * Ask the operator's terminal to approve a console's attach request, and act on
 * the answer. This is the out-of-band half of the request pattern: the request
 * arrived over the socket; the answer arrives from the keyboard of whoever
 * started the daemon, and the write happens here — in the process that holds
 * filesystem authority — rather than in the daemon, which holds none.
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
 * Run the `ui` subcommand: start pawd in this process and serve the console for a
 * repository until the operator interrupts it.
 *
 * @param {string[]} rest - The words after `ui`.
 * @param {(lines: string[]) => void} print - Line printer.
 * @returns {Promise<never>} Never resolves; the command serves until interrupted.
 */
export async function runUi(
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
      onAttach: (path, mode) => {
        void approveAttach(path, mode, () => handle);
      },
      ...(control ? { control } : {}),
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
    control
      ? 'control enabled · the console may edit bindings, prune violations, and stop enforcement'
      : 'observational · pass --control to let the console write',
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
