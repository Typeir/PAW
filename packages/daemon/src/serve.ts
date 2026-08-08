/**
 * PAW Daemon Service
 *
 * @fileoverview `pawd` as a function, and the thing it serves is a **repository**
 * — not one plan. It discovers every `*.swarm.mjs` the repo holds and finds its
 * config; which plan is in view is a selection carried on the request
 * (`/api/state?plan=…`), so one console covers a workspace with twenty plans
 * instead of one console per swarm. A selected plan is imported once and cached
 * against its mtime, so polling costs nothing and editing the file reloads it on
 * the next poll. A path the repository does not hold is refused rather than
 * imported.
 *
 * Every effect it needs — reading a file, importing a plan module, listing
 * processes and files, reading the host, binding a socket, scheduling a poll —
 * arrives through {@link DaemonRuntime}, so the whole sequence is unit-tested
 * against fakes while `nodeRuntime` supplies the real ones. That is also what
 * lets `paw ui` and the Electron shell run the daemon in their own process
 * rather than spawning a second one.
 *
 * @module @paw/daemon/serve
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  CLOSE_SHUTDOWN,
  LIVE_TOPICS,
  buildRegistry,
  runDoctor,
  type AttachState,
  type BudgetSummary,
  type DispatchEvent,
  type DispatchResult,
  type HostInfo,
  type HostProcess,
  type InitMode,
  type RunSettings,
  type LogEntry,
  type ModelPort,
  type PawSnapshot,
  type PlanSlice,
  type PlansSlice,
  type RunProgress,
  type SwarmPlan,
} from '@paw/core';
import { createBus, type LiveBus } from './domain/bus.js';
import { createLogRing } from './domain/logRing.js';
import {
  buildPlanSlice,
  composeSnapshot,
  createVersionedCache,
  emptyPlanSlice,
  idleBudget,
  idleRun,
} from './domain/cache.js';
import type { ServerIdentity } from './infrastructure/identityStore.js';
import { discoverPlans, findConfig, selectPlan } from './domain/plans.js';
import { route, type HttpRequest, type HttpResponse } from './domain/router.js';
import {
  allowedOrigins,
  decideUpgrade,
  inlineScriptHashes,
  type UpgradeRefusal,
} from './infrastructure/security.js';
import { createSessionRegistry, type WsSessionPort } from './sessions.js';
import { toRunProgress, trackRun } from './run.js';
import { buildFileTree, type FileEntry } from './domain/tree.js';

/**
 * The loopback address the daemon binds. The control API is local-only by
 * construction: it reports host processes, and that never leaves the machine.
 */
export const LOOPBACK = '127.0.0.1';

/**
 * How often the owned-process table, the file tree, and the plan list are
 * re-read, in milliseconds.
 */
export const PROCESS_POLL_MS = 3000;

/**
 * How often the host facts are re-read and published, in milliseconds. Faster
 * than the other sources because this tick is also the console's liveness
 * signal: a client that has heard nothing for several ticks knows the daemon is
 * gone rather than merely idle.
 */
export const HOST_TICK_MS = 1000;

/**
 * Whether two slice values are the same, by value. Sources publish on change,
 * and "change" for a process table or a file listing means different contents —
 * a fresh array of identical rows is not news, and telling every open console
 * about it three times a second is the waste this comparison exists to avoid.
 *
 * @param {unknown} previous - The last published value.
 * @param {unknown} next - The freshly read one.
 * @returns {boolean} True when nothing changed.
 */
export function sameValue(previous: unknown, next: unknown): boolean {
  return JSON.stringify(previous) === JSON.stringify(next);
}

/**
 * A thrown value as a line an operator can read.
 *
 * @param {unknown} error - What was thrown.
 * @returns {string} The message.
 */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Connectors this repo can resolve, for the config doctor.
 */
const KNOWN_CONNECTORS = ['copilot-hooks'];

/**
 * The port every role is bound to while the daemon is only reporting. `pawd`
 * builds a registry so the doctor can say whether a role's model satisfies it,
 * and never dispatches a member — so a call here means something asked the
 * reporting daemon to spend tokens, and it refuses loudly instead of quietly
 * returning an empty completion that a caller would treat as a model's answer.
 */
export const REFUSING_MODEL: ModelPort = {
  complete: async () => {
    throw new Error('pawd reports state and does not dispatch members');
  },
};

/**
 * A bound HTTP server.
 *
 * @interface ServerHandle
 * @property {number} port - The port actually bound (resolved when 0 was asked for).
 * @property {() => Promise<void>} close - Stop listening.
 */
export interface ServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * The certificate a server presents.
 *
 * @interface TlsMaterial
 * @property {string} cert - The server certificate chain, PEM.
 * @property {string} key - Its private key, PEM.
 */
export interface TlsMaterial {
  readonly cert: string;
  readonly key: string;
}

/**
 * What the runtime can tell the daemon about a socket asking to be upgraded.
 *
 * @interface UpgradeContext
 * @property {string} [host] - The request's `Host`.
 * @property {string} [origin] - The request's `Origin`.
 * @property {string[]} protocols - The subprotocols it offered.
 */
export interface UpgradeContext {
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly protocols: readonly string[];
}

/**
 * What the runtime drives once a socket has been accepted.
 *
 * @interface AcceptedSocket
 * @property {(raw: string) => Promise<void>} message - One text frame arrived.
 * @property {() => void} closed - The peer went away.
 */
export interface AcceptedSocket {
  message(raw: string): Promise<void>;
  closed(): void;
}

/**
 * The daemon's half of the WebSocket handshake, injected into the runtime.
 *
 * Split in two on purpose: `check` runs while the connection is still plain HTTP
 * — the cheap place to refuse, where a "no" costs a socket close instead of a
 * session — and `accept` runs only after the upgrade succeeded.
 *
 * @interface SocketHooks
 * @property {(context: UpgradeContext) => UpgradeRefusal | null} check - Whether to upgrade at all.
 * @property {(port: WsSessionPort) => AcceptedSocket} accept - Adopt an upgraded socket.
 */
export interface SocketHooks {
  check(context: UpgradeContext): UpgradeRefusal | null;
  accept(port: WsSessionPort): AcceptedSocket;
}

/**
 * Every effect the daemon needs, injected.
 *
 * @interface DaemonRuntime
 * @property {(path: string) => Promise<string>} readFile - Read a file as UTF-8 text.
 * @property {(path: string, version: number) => Promise<unknown>} importModule - Import a module, reloading it when `version` changes.
 * @property {(path: string) => Promise<number>} modifiedAt - A file's last-modified time in milliseconds.
 * @property {() => Promise<HostProcess[]>} listProcesses - The processes PAW owns.
 * @property {(root: string) => Promise<FileEntry[]>} listFiles - The repository listing under a root.
 * @property {() => HostInfo} readHost - The host facts, read fresh.
 * @property {() => string} now - An ISO timestamp.
 * @property {() => number} clock - Epoch milliseconds, for wire timestamps and session timers.
 * @property {(message: string) => void} warn - Report something the operator should see but that must not stop the daemon.
 * @property {() => string} randomToken - A fresh, unguessable session token.
 * @property {() => Promise<ServerIdentity>} identity - This machine's TLS identity, issued or renewed as needed.
 * @property {() => Promise<string>} readPage - The HTML to serve at `/`.
 * @property {(handler, port, host, tls) => Promise<ServerHandle>} listen - Bind a TLS server.
 * @property {(fn, ms) => () => void} schedule - Run `fn` every `ms`; returns a canceller.
 */
export interface DaemonRuntime {
  readFile(path: string): Promise<string>;
  importModule(path: string, version: number): Promise<unknown>;
  modifiedAt(path: string): Promise<number>;
  listProcesses(): Promise<HostProcess[]>;
  listFiles(root: string): Promise<FileEntry[]>;
  readHost(): HostInfo;
  now(): string;
  clock(): number;
  warn(message: string): void;
  randomToken(): string;
  identity(): Promise<ServerIdentity>;
  readPage(): Promise<string>;
  listen(
    handler: (request: HttpRequest) => Promise<HttpResponse>,
    hooks: SocketHooks,
    port: number,
    host: string,
    tls: TlsMaterial,
  ): Promise<ServerHandle>;
  schedule(fn: () => void, ms: number): () => void;
}

/**
 * What a real dispatch reported back.
 *
 * @interface RunReport
 * @property {DispatchResult} result - Core's own dispatch result.
 * @property {BudgetSummary} usage - The tokens the run actually spent.
 */
export interface RunReport {
  readonly result: DispatchResult;
  readonly usage: BudgetSummary;
}

/**
 * Releases the plan's herd. Supplied by the consumer, because choosing the model
 * a run is dispatched against — a deterministic fake, or a live provider — is a
 * composition decision, and the reporting daemon takes no part in it.
 *
 * The second argument is how the run reports itself while it happens. A
 * dispatcher that ignores it still works; one that forwards `dispatchSwarm`'s
 * progress lets the console fill in member by member instead of staying blank
 * until the last one lands.
 */
export type Dispatcher = (
  plan: SwarmPlan<unknown>,
  onProgress: (event: DispatchEvent) => void,
) => Promise<RunReport>;

/**
 * What to serve.
 *
 * @interface DaemonOptions
 * @property {string} [root] - The repository to serve; defaults to the working directory.
 * @property {string} [configPath] - An explicit config path; otherwise `.paw/config.json` is used when the repo has one.
 * @property {string} [planPath] - A plan to open on; otherwise the console opens with none selected.
 * @property {number} [port] - Port to bind; 0 (the default) takes an ephemeral one.
 * @property {number} [pollMs] - How often to re-read the process table, tree, config, and plan list.
 * @property {number} [hostMs] - How often to re-read and publish the host facts.
 * @property {readonly string[]} [allowOrigins] - Extra origins permitted to call the API, e.g. a GUI development server.
 * @property {Dispatcher} [dispatch] - Release the opening plan's herd once, and report the run live.
 * @property {string} [scopeCeiling] - Permit consoles to re-scope the daemon, within this directory. Omit to refuse every scope request.
 * @property {(path: string, mode: InitMode) => void} [onAttach] - Receive attach requests. The daemon never writes; whoever supplies this decides.
 */
export interface DaemonOptions {
  readonly root?: string;
  readonly configPath?: string;
  readonly planPath?: string;
  readonly port?: number;
  readonly pollMs?: number;
  readonly hostMs?: number;
  readonly allowOrigins?: readonly string[];
  readonly dispatch?: Dispatcher;
  readonly scopeCeiling?: string;
  onAttach?(path: string, mode: InitMode): void;
  onRelease?(settings: RunSettings): void;
}

/**
 * A running daemon.
 *
 * @interface DaemonHandle
 * @property {string} url - The URL the console is served at.
 * @property {number} port - The bound port.
 * @property {string} root - The repository being served.
 * @property {string} token - The per-boot credential every API call must present.
 * @property {ServerIdentity} identity - The TLS identity it is serving with, for trust hints and certificate pinning.
 * @property {LiveBus} bus - Where the sources publish; what a live session subscribes to.
 * @property {string[]} plans - The plans discovered in it.
 * @property {string | null} openedOn - The plan the daemon opened on, if any.
 * @property {Promise<void> | null} dispatched - Settles when a released herd finishes; null when no run was asked for. Rejects loudly if the run failed.
 * @property {(plan?: string | null) => Promise<PawSnapshot>} snapshot - The current snapshot for a plan, read live.
 * @property {(path: string) => Promise<void>} rescope - Point the daemon at another repository and republish. Unbounded, unlike the console's scope request: the caller already holds the process.
 * @property {() => Promise<void>} close - Stop polling and stop listening.
 */
export interface DaemonHandle {
  readonly url: string;
  readonly port: number;
  readonly root: string;
  readonly token: string;
  readonly identity: ServerIdentity;
  readonly bus: LiveBus;
  readonly plans: readonly string[];
  readonly openedOn: string | null;
  readonly dispatched: Promise<void> | null;
  snapshot(plan?: string | null): Promise<PawSnapshot>;
  rescope(path: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Take the swarm plan out of an imported module, failing loud when the module
 * exports none — a selection that is not a plan has nothing to show.
 *
 * @param {unknown} mod - The imported module.
 * @param {string} path - The path it came from, for the error message.
 * @returns {SwarmPlan<unknown>} The plan.
 */
export function toPlan(mod: unknown, path: string): SwarmPlan<unknown> {
  const holder = mod as { default?: SwarmPlan<unknown>; plan?: SwarmPlan<unknown> };
  const plan = holder?.default ?? holder?.plan;
  if (!plan || typeof plan.brief !== 'function') {
    throw new Error(`"${path}" does not export a swarm plan`);
  }
  return plan;
}

/**
 * How many models the config declares — the Keys rail count.
 *
 * @param {Record<string, unknown>} config - The parsed config.
 * @returns {number} The model count.
 */
export function modelCount(config: Record<string, unknown>): number {
  const models = config.models;
  return models !== null && typeof models === 'object' ? Object.keys(models).length : 0;
}

/**
 * A repo-relative path as the runtime should open it.
 *
 * @param {string} root - The served repository.
 * @param {string} path - A repo-relative path.
 * @returns {string} The path to hand the runtime.
 */
export function underRoot(root: string, path: string): string {
  const base = root === '' ? '.' : root.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${base}/${path}`;
}

/**
 * A plan loaded from disk, with what it was loaded from.
 *
 * @interface LoadedPlan
 * @property {SwarmPlan<unknown>} plan - The plan itself.
 * @property {string} source - The module's source text.
 * @property {number} modifiedAt - The mtime the load was made against.
 */
interface LoadedPlan {
  readonly plan: SwarmPlan<unknown>;
  readonly source: string;
  readonly modifiedAt: number;
}

/**
 * Start the daemon.
 *
 * @param {DaemonOptions} options - What to serve.
 * @param {DaemonRuntime} runtime - The effects to serve it with.
 * @returns {Promise<DaemonHandle>} The running daemon.
 */
export async function runDaemon(
  options: DaemonOptions,
  runtime: DaemonRuntime,
): Promise<DaemonHandle> {
  let root = options.root ?? '.';
  const log = createLogRing(() => runtime.now());

  /**
   * How the current root stands: a repository with no PAW config is the state a
   * console turns into "pick a project", so it is reported rather than inferred
   * from an empty plan list.
   *
   * @returns {AttachState} The current attach state.
   */
  const attachState = (): AttachState => ({
    status: configPath === '' ? 'unconfigured' : 'idle',
    path: root,
  });

  const bus = createBus((topic, error) => {
    // Reported straight to the terminal rather than through `report`: a listener
    // that threw is very often a session, and publishing to the bus from inside
    // its own fan-out is how one broken session becomes a loop.
    runtime.warn(`a "${topic}" listener failed: ${reason(error)}`);
  });

  /**
   * Tell the operator's terminal and every open console the same thing. A
   * console cannot read stderr, so a daemon that reported a failing source only
   * to a terminal nobody is watching has reported it to nobody.
   *
   * @param {string} message - What happened.
   * @param {LogEntry['level']} [level] - How loud it is.
   */
  const report = (message: string, level: LogEntry['level'] = 'warn'): void => {
    runtime.warn(message);
    bus.publish('log', [log.append(level, message)]);
  };

  let entries = await runtime.listFiles(root);
  let configPath = findConfig(options.configPath, entries);
  let plansSlice: PlansSlice = { plans: discoverPlans(entries), configPath };
  let tree = buildFileTree(entries);

  let config =
    configPath === ''
      ? {}
      : (JSON.parse(await runtime.readFile(underRoot(root, configPath))) as Record<
          string,
          unknown
        >);

  const page = await runtime.readPage();
  // Hashed once, at boot: the console is a self-contained artifact whose inline
  // bundle cannot change while the daemon runs, so the CSP can name it exactly
  // instead of permitting inline scripts in general.
  const scriptHashes = inlineScriptHashes(page);
  // Before anything is scheduled or bound: a daemon with no usable identity has
  // nothing to serve, and failing here leaves no poller and no socket behind.
  const identity = await runtime.identity();
  let registry = buildRegistry(config, () => REFUSING_MODEL);
  let doctor = runDoctor(config, registry, KNOWN_CONNECTORS);
  const startedAt = runtime.now();
  const runId = startedAt.slice(11, 19).replace(/:/g, '-');
  const port = options.port ?? 0;

  const loaded = new Map<string, LoadedPlan>();
  const planSlices = createVersionedCache<PlanSlice>();

  /**
   * Load a plan, reusing the cached module while the file has not changed.
   *
   * @param {string} path - The repo-relative plan path.
   * @returns {Promise<LoadedPlan>} The loaded plan.
   */
  const loadPlan = async (path: string): Promise<LoadedPlan> => {
    const full = underRoot(root, path);
    const modifiedAt = await runtime.modifiedAt(full);
    const cached = loaded.get(path);
    if (cached && cached.modifiedAt === modifiedAt) {
      return cached;
    }
    const fresh: LoadedPlan = {
      plan: toPlan(await runtime.importModule(full, modifiedAt), path),
      source: await runtime.readFile(full),
      modifiedAt,
    };
    loaded.set(path, fresh);
    return fresh;
  };

  /**
   * The rendered slice for a plan, built once per version of its file. The load
   * above avoids re-importing an unchanged module; this avoids re-rendering
   * every brief in it, which is the expensive half.
   *
   * @param {string} path - The repo-relative plan path.
   * @returns {Promise<PlanSlice>} The slice.
   */
  const planSliceFor = async (path: string): Promise<PlanSlice> => {
    const current = await loadPlan(path);
    return planSlices.read(path, current.modifiedAt, () =>
      buildPlanSlice(current.plan, current.source, path),
    );
  };

  const openedOn = selectPlan(options.planPath ?? null, plansSlice.plans);
  let processes = await runtime.listProcesses();
  let configVersion = configPath === '' ? 0 : await runtime.modifiedAt(underRoot(root, configPath));
  // The last slice published per plan, so a plan is only announced when its
  // file actually changed. Keyed by path because sessions watch different plans.
  const published = new Map<string, PlanSlice>();

  /**
   * Run a source, reporting a failure rather than leaving a rejected promise
   * loose. A poll that throws — a file deleted mid-read, a plan that stopped
   * parsing — must not take the daemon down and must not pass unnoticed.
   *
   * @param {string} what - The source's name, for the report.
   * @param {() => Promise<void>} read - The source.
   */
  const runSource = (what: string, read: () => Promise<void>): void => {
    void read().catch((error: unknown) => {
      report(`${what} source failed: ${reason(error)}`, 'error');
    });
  };

  /**
   * Re-read the owned process table and publish only a real change.
   */
  const readProcesses = async (): Promise<void> => {
    const next = await runtime.listProcesses();
    if (!sameValue(processes, next)) {
      processes = next;
      bus.publish('processes', next);
    }
  };

  /**
   * Re-read the repository listing, republishing the plan list and the tree
   * independently — a new source file changes the tree without changing the
   * plans, and the console should not be told the picker moved when it did not.
   */
  const readListing = async (): Promise<void> => {
    entries = await runtime.listFiles(root);
    const nextPlans: PlansSlice = { plans: discoverPlans(entries), configPath };
    if (!sameValue(plansSlice, nextPlans)) {
      plansSlice = nextPlans;
      bus.publish('plans', nextPlans);
    }
    const nextTree = buildFileTree(entries);
    if (!sameValue(tree, nextTree)) {
      tree = nextTree;
      bus.publish('tree', nextTree);
    }
  };

  /**
   * Re-read the config when its file changes, so an edited config re-runs the
   * doctor instead of reporting the state of the machine at boot forever.
   */
  const readConfig = async (): Promise<void> => {
    if (configPath === '') {
      return;
    }
    const full = underRoot(root, configPath);
    const version = await runtime.modifiedAt(full);
    if (version === configVersion) {
      return;
    }
    configVersion = version;
    config = JSON.parse(await runtime.readFile(full)) as Record<string, unknown>;
    registry = buildRegistry(config, () => REFUSING_MODEL);
    doctor = runDoctor(config, registry, KNOWN_CONNECTORS);
    bus.publish('doctor', doctor);
  };

  /**
   * Re-render every plan somebody is watching when its file changes. The cache
   * returns the identical object while the version holds, so identity is the
   * change test and no deep comparison of several hundred briefs is needed.
   *
   * The set is the **union of what the sessions watch**, plus whatever the
   * daemon opened on, because sessions choose their own plan and a session
   * receives only the slice for the plan it chose. Re-rendering just `openedOn`
   * would leave every other console rendering briefs that never update again,
   * with no error and no visible degradation — silently stale, which is worse
   * than visibly broken.
   */
  const readWatchedPlan = async (): Promise<void> => {
    const wanted = new Set(sessions.watched());
    if (openedOn !== null) {
      wanted.add(openedOn);
    }
    for (const path of wanted) {
      if (!plansSlice.plans.includes(path)) {
        continue;
      }
      try {
        const slice = await planSliceFor(path);
        if (published.get(path) !== slice) {
          published.set(path, slice);
          bus.publish('planDetail', slice);
        }
      } catch (error: unknown) {
        // Per plan, so one broken module does not starve the others. A plan
        // that stopped parsing is an ordinary thing — the operator is editing
        // it — and letting it abort the loop would freeze plan updates for
        // every console watching a different, perfectly healthy plan.
        report(`plan "${path}" could not be read: ${reason(error)}`, 'error');
      }
    }
    // A plan nobody watches any more is forgotten, so the map cannot grow with
    // every plan an operator has ever clicked on during a long-lived daemon.
    for (const path of [...published.keys()]) {
      if (!wanted.has(path)) {
        published.delete(path);
      }
    }
  };

  /**
   * Point the daemon at another repository and republish everything derived
   * from it.
   *
   * A read: it changes what is looked at and writes nothing. Every slice below
   * is already re-derived when files change, so re-rooting reuses that rather
   * than restarting — open consoles keep their sockets and are told the new
   * state, instead of being dropped and made to reconnect.
   *
   * @param {string} next - The repository to serve.
   */
  const rescope = async (next: string): Promise<void> => {
    root = next;
    entries = await runtime.listFiles(root);
    configPath = findConfig(options.configPath, entries);
    config =
      configPath === ''
        ? {}
        : (JSON.parse(await runtime.readFile(underRoot(root, configPath))) as Record<
            string,
            unknown
          >);
    configVersion =
      configPath === '' ? 0 : await runtime.modifiedAt(underRoot(root, configPath));
    registry = buildRegistry(config, () => REFUSING_MODEL);
    doctor = runDoctor(config, registry, KNOWN_CONNECTORS);
    plansSlice = { plans: discoverPlans(entries), configPath };
    tree = buildFileTree(entries);
    bus.publish('plans', plansSlice);
    bus.publish('tree', tree);
    bus.publish('doctor', doctor);
    bus.publish('attach', attachState());
  };

  const token = runtime.randomToken();
  const sessions = createSessionRegistry({
    token,
    clock: () => runtime.clock(),
    snapshot: (plan) => snapshot(plan),
    plans: () => plansSlice.plans,
    warn: (message) => report(message, 'error'),
    ...(options.scopeCeiling === undefined
      ? {}
      : {
          scopeCeiling: options.scopeCeiling,
          onScope: (path: string): void => {
            void rescope(path).catch((error: unknown) => {
              report(`could not scope to ${path}: ${reason(error)}`, 'error');
              bus.publish('attach', {
                status: 'failed',
                path,
                reason: reason(error),
              });
            });
          },
        }),
    ...(options.onAttach === undefined ? {} : { onAttach: options.onAttach }),
    ...(options.onRelease === undefined ? {} : { onRelease: options.onRelease }),
  });

  // One subscription per topic, forwarding to every live session. The sources
  // publish once and know nothing about sockets; the sessions receive without
  // knowing what produced the slice.
  for (const topic of LIVE_TOPICS) {
    bus.subscribe(topic, (data) => {
      sessions.broadcast(topic, data);
    });
  }

  const stopHostTicker = runtime.schedule(() => {
    // Published every tick rather than on change: this is the console's liveness
    // signal, so silence has to mean "the daemon stopped", not "nothing moved".
    bus.publish('host', runtime.readHost());
    // The same tick advances session timers, so an unauthenticated socket is
    // closed on schedule without a second timer to keep in step with this one.
    sessions.tick(runtime.clock());
  }, options.hostMs ?? HOST_TICK_MS);

  const stopPolling = runtime.schedule(() => {
    runSource('process', readProcesses);
    runSource('config', readConfig);
    // Chained, not raced: the plan reader decides what still exists by asking
    // `plansSlice`, so running it beside the listing reader would let it judge
    // against last tick's answer and re-render a plan that has just been
    // deleted. A listing that fails is reported and the plan read still runs
    // against the last good listing — otherwise one unreadable directory would
    // freeze every console's plan updates for as long as it stayed unreadable.
    runSource('listing', async () => {
      try {
        await readListing();
      } catch (error: unknown) {
        report(`listing source failed: ${reason(error)}`, 'error');
      }
      await readWatchedPlan();
    });
  }, options.pollMs ?? PROCESS_POLL_MS);

  let run: RunProgress | undefined;
  let budget: BudgetSummary | undefined;
  let socket = `${LOOPBACK}:${port}`;
  const snapshot = async (asked: string | null = openedOn): Promise<PawSnapshot> => {
    const selected = selectPlan(asked, plansSlice.plans);
    return composeSnapshot({
      host: runtime.readHost(),
      processes,
      plans: plansSlice,
      planDetail: selected === null ? emptyPlanSlice() : await planSliceFor(selected),
      doctor,
      run: run ?? idleRun(runId, startedAt),
      budget: budget ?? idleBudget(),
      violations: [],
      socket,
      gates: 0,
      keys: modelCount(config),
    });
  };

  /**
   * Release the opening plan's herd, reporting progress as it lands.
   *
   * Deliberately **not** started until the socket is bound. A run releases real
   * members against a real provider and spends real tokens; starting it before
   * the bind means a daemon that fails on `EADDRINUSE` — an everyday outcome
   * when the operator names a port — leaves a live run going with nobody
   * holding it, no console to watch it, and no handle to stop it. The operator
   * reads "address already in use", reasonably concludes nothing started, and
   * the provider bill says otherwise.
   *
   * @param {Dispatcher} dispatch - The consumer's dispatcher.
   * @returns {Promise<void>} Settles when the herd finishes.
   */
  const release = async (dispatch: Dispatcher): Promise<void> => {
    if (openedOn === null) {
      throw new Error('cannot release a herd: no plan was named to run');
    }
    const tracker = trackRun(runId, startedAt);
    const report = await dispatch((await loadPlan(openedOn)).plan, (event) => {
      run = tracker.apply(event);
      bus.publish('run', run);
    });
    // The finished result is authoritative: the tracker reports what it was
    // told, and a dispatcher that reported nothing must still end correct.
    run = toRunProgress(report.result, runId, startedAt);
    budget = report.usage;
    bus.publish('run', run);
    bus.publish('budget', budget);
  };

  let boundPort = port;
  let origins = allowedOrigins(port, options.allowOrigins);

  const hooks: SocketHooks = {
    check: (context) =>
      decideUpgrade({
        host: context.host,
        origin: context.origin,
        protocols: context.protocols,
        port: boundPort,
        origins,
        liveSessions: sessions.live(),
        preAuthSessions: sessions.preAuth(),
      }),
    accept: (socket) => {
      const session = sessions.open(socket, openedOn);
      return {
        message: (raw) => session.receive(raw),
        closed: () => session.close(CLOSE_SHUTDOWN, 'socket closed'),
      };
    },
  };

  // The pollers are already running by the time the socket is bound, and a bind
  // can fail — a port the operator named is often already taken. Leaving two
  // intervals behind on that path means a daemon that failed to start is still
  // reading the process table every three seconds for the life of the process.
  let server: ServerHandle;
  try {
    server = await runtime.listen(
      async (request) =>
        route(request, {
          page,
          snapshot,
          tree: () => tree,
          token,
          port: boundPort,
          scriptHashes,
          origins,
        }),
      hooks,
      port,
      LOOPBACK,
      { cert: identity.cert, key: identity.key },
    );
  } catch (error: unknown) {
    stopHostTicker();
    stopPolling();
    sessions.shutdown();
    throw error;
  }
  boundPort = server.port;
  origins = allowedOrigins(server.port, options.allowOrigins);
  socket = `${LOOPBACK}:${server.port}`;

  // Now, and not a line earlier — see `release`. The rejection is claimed
  // immediately because the caller cannot attach a handler until this function
  // returns, and an unclaimed rejection exits the process.
  const dispatched = options.dispatch ? release(options.dispatch) : null;
  dispatched?.catch(() => undefined);

  return {
    url: `https://${socket}/`,
    port: server.port,
    get root(): string {
      return root;
    },
    token,
    identity,
    bus,
    plans: plansSlice.plans,
    openedOn,
    dispatched,
    snapshot,
    rescope,
    close: async () => {
      stopHostTicker();
      stopPolling();
      // Sessions are told why before the socket goes: a console that is closed
      // with a shutdown code stops retrying, where an abrupt drop reconnects.
      sessions.shutdown();
      await server.close();
    },
  };
}
