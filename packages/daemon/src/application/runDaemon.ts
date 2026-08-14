/**
 * PAW daemon service.
 *
 * @fileoverview Serve `pawd` as function. Serve repository, no one plan.
 * Find every `*.swarm.mjs` repo hold, find set config. Which plan in view be
 * selection carried on request (`/api/state?plan=…`), so one console cover
 * workspace with twenty plan, no one console per swarm. Selected plan import
 * once, cache against mtime. Poll cost nothing, edit file reload next poll.
 * Path repository no hold refuse, no import.
 *
 * Every effect thing need — read file, import plan module, list process and
 * file, read host, bind socket, schedule poll — come through
 * {@link DaemonRuntime}, so whole sequence unit-test against fakes while
 * `nodeRuntime` supply real one. Same let `paw ui` and Electron shell run
 * daemon in own process, no spawn second one.
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
  type HostInfo,
  type HostProcess,
  type LogEntry,
  type PawSnapshot,
  type PlanSlice,
  type PlansSlice,
  type RunProgress,
  type RunSettings,
  type SwarmPlan,
} from '@paw/core';
import {
  HOST_TICK_MS,
  LOOPBACK,
  PROCESS_POLL_MS,
  REFUSING_MODEL,
  modelCount,
  reason,
  sameValue,
  toPlan,
  underRoot,
  type AcceptedSocket,
  type DaemonHandle,
  type DaemonOptions,
  type DaemonRuntime,
  type Dispatcher,
  type RunReport,
  type ServerHandle,
  type SocketHooks,
  type TlsMaterial,
  type UpgradeContext,
} from './daemonContracts.js';
import { createBus, type LiveBus } from '../domain/bus.js';
import { LOG_CAPACITY, createLogRing } from '../domain/logRing.js';
import {
  buildPlanSlice,
  composeSnapshot,
  createVersionedCache,
  emptyPlanSlice,
  idleBudget,
  idleRun,
} from '../domain/cache.js';
import type { ServerIdentity } from '../infrastructure/identityStore.js';
import { discoverPlans, findConfig, selectPlan } from '../domain/plans.js';
import { route, type HttpRequest, type HttpResponse } from '../domain/router.js';
import {
  allowedOrigins,
  decideUpgrade,
  inlineScriptHashes,
  type UpgradeRefusal,
} from '../infrastructure/security.js';
import { createSessionRegistry } from './sessionRegistry.js';
import type { WsSessionPort } from '../domain/session.js';
import { toRunProgress, trackRun } from './run.js';
import { buildFileTree, type FileEntry } from '../domain/tree.js';

/**
 * Connector repo can resolve, for config doctor.
 */
const KNOWN_CONNECTORS = ['copilot-hooks'];

/**
 * Plan loaded from disk, with load source.
 *
 * @interface LoadedPlan
 * @property {SwarmPlan<unknown>} plan - Plan itself.
 * @property {string} source - Module source text.
 * @property {number} modifiedAt - Mtime load made against.
 */
interface LoadedPlan {
  readonly plan: SwarmPlan<unknown>;
  readonly source: string;
  readonly modifiedAt: number;
}

/**
 * Start daemon.
 *
 * @param {DaemonOptions} options - What to serve.
 * @param {DaemonRuntime} runtime - Effects to serve it with.
 * @returns {Promise<DaemonHandle>} Running daemon.
 */
export async function runDaemon(
  options: DaemonOptions,
  runtime: DaemonRuntime,
): Promise<DaemonHandle> {
  let root = options.root ?? '.';
  const log = createLogRing(() => runtime.now());
  log.seed(options.logSink?.load(LOG_CAPACITY) ?? []);

  /**
   * Current root attach state. A repo without PAW config makes the state
   * console show "pick a project"; report that directly, do not infer it from
   * an empty plan list.
   *
   * @returns {AttachState} Current attach state.
   */
  const attachState = (): AttachState => ({
    status: configPath === '' ? 'unconfigured' : 'idle',
    path: root,
  });

  const bus = createBus((topic, error) => {
    // Report straight to terminal, no through `report`. Listener that threw
    // often be a session, and publish to bus from inside own fan-out make one
    // broken session a loop.
    runtime.warn(`a "${topic}" listener failed: ${reason(error)}`);
  });

  /**
   * Write message to operator terminal and publish it to every open console. A
   * console cannot read stderr, so a failing-source report written only to the
   * terminal would go unseen.
   *
   * @param {string} message - What happen.
   * @param {LogEntry['level']} [level] - How loud.
   */
  const report = (message: string, level: LogEntry['level'] = 'warn'): void => {
    runtime.warn(message);
    const entry = log.append(level, message);
    options.logSink?.append(entry);
    bus.publish('log', [entry]);
  };

  const recentRoutes = options.recent;
  /**
   * Remember grabbed route in recent list, best effort. A recent-store write
   * failure is reported and scoping still proceeds — a broken `recent.json`
   * never blocks a grab.
   *
   * @param {string} path - Route just scoped to.
   * @returns {Promise<void>} When attempt settle.
   */
  const rememberRoute = async (path: string): Promise<void> => {
    if (recentRoutes === undefined) {
      return;
    }
    try {
      await recentRoutes.record(path);
    } catch (error: unknown) {
      report(`could not record recent route ${path}: ${reason(error)}`);
    }
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
  // Hash once, at boot. Console be self-contained artifact, inline bundle cannot
  // change while daemon run, so CSP can name exact, no permit all inline script.
  const scriptHashes = inlineScriptHashes(page);
  // Before anything schedule or bind. Daemon with no usable identity got
  // nothing to serve, and fail here leave no poller and no socket behind.
  const identity = await runtime.identity();
  let registry = buildRegistry(config, () => REFUSING_MODEL);
  let doctor = runDoctor(config, registry, KNOWN_CONNECTORS);
  const startedAt = runtime.now();
  const runId = startedAt.slice(11, 19).replace(/:/g, '-');
  const port = options.port ?? 0;
  await rememberRoute(root);

  const loaded = new Map<string, LoadedPlan>();
  const planSlices = createVersionedCache<PlanSlice>();

  /**
   * Load plan, reuse cached module while file no change.
   *
   * @param {string} path - Repo-relative plan path.
   * @returns {Promise<LoadedPlan>} Loaded plan.
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
   * Rendered slice for a plan, built once per file version. Load above no
   * re-import unchanged module; this no re-render every brief in it, which be
   * expensive half.
   *
   * @param {string} path - Repo-relative plan path.
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
  // Last slice published per plan, so announce plan only when file actually
  // change. Key by path because sessions watch different plan.
  const published = new Map<string, PlanSlice>();

  /**
   * Run a source, report failure, no leave rejected promise loose. Poll that
   * throw — file deleted mid-read, plan stop parsing — must no take daemon
   * down and must no pass unnoticed.
   *
   * @param {string} what - Source name, for report.
   * @param {() => Promise<void>} read - The source.
   */
  const runSource = (what: string, read: () => Promise<void>): void => {
    void read().catch((error: unknown) => {
      report(`${what} source failed: ${reason(error)}`, 'error');
    });
  };

  /**
   * Re-read owned process table, publish only when the table changed.
   */
  const readProcesses = async (): Promise<void> => {
    const next = await runtime.listProcesses();
    if (!sameValue(processes, next)) {
      processes = next;
      bus.publish('processes', next);
    }
  };

  /**
   * Re-read repository listing, republish plan list and tree separately — a
   * new source file changes tree but not plan list, so console is not told the
   * picker moved when it did not.
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
   * Re-read config when file change, so edited config re-run doctor, no report
   * machine state at boot forever.
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
   * Re-render every watched plan when file change. The cache returns the
   * identical object while version is unchanged, so identity equality is the
   * change test instead of a deep compare of several hundred entries.
   *
   * Wanted set is the union of sessions.watched() plus the path daemon opened
   * on, because each session picks its own plan and receives only that plan's
   * slice. Rendering only `openedOn` leaves every other console showing a
   * brief that never updates again — stale without error or visible sign.
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
        // Guarded per plan, so one broken module does not block others. A plan
        // that stops parsing is a normal case — an operator editing it — and
        // letting it abort the loop would freeze plan updates for every
        // console watching a different, healthy plan.
        report(`plan "${path}" could not be read: ${reason(error)}`, 'error');
      }
    }
    // Plan nobody watch any more get forgotten, so map cannot grow with every
    // plan an operator ever clicked during long-lived daemon.
    for (const path of [...published.keys()]) {
      if (!wanted.has(path)) {
        published.delete(path);
      }
    }
  };

  /**
   * Point daemon at another repository and republish everything derived from
   * it.
   *
   * A read: change what looked at, write nothing. Every slice below already
   * re-derived when files change, so re-rooting reuse that, no restart — open
   * console keep sockets and get told new state, no drop and no reconnect.
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
    await rememberRoute(root);
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

  // One subscription per topic, forward to every live session. Sources publish
  // once and know nothing about socket; sessions receive without know what
  // produce the slice.
  for (const topic of LIVE_TOPICS) {
    bus.subscribe(topic, (data) => {
      sessions.broadcast(topic, data);
    });
  }

  const stopHostTicker = runtime.schedule(() => {
    // Publish every tick even when unchanged. This is the console liveness
    // signal, so silence must mean "daemon stopped", not "nothing moved".
    bus.publish('host', runtime.readHost());
    // Same tick advance session timers, so unauthenticated socket close on
    // schedule, no need second timer to keep in step with this one.
    sessions.tick(runtime.clock());
  }, options.hostMs ?? HOST_TICK_MS);

  const stopPolling = runtime.schedule(() => {
    runSource('process', readProcesses);
    runSource('config', readConfig);
    // Chained, no raced. Plan reader decide what still exist by ask
    // `plansSlice`, so run it beside listing reader would let it judge against
    // last tick answer and re-render a plan that just been deleted. Listing that
    // fail get reported and plan read still run against last good listing —
    // else one unreadable directory would freeze every console plan update for
    // as long it stay unreadable.
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
    const host = runtime.readHost();
    return composeSnapshot({
      host,
      processes,
      root: root === '.' ? host.cwd : root,
      plans: plansSlice,
      planDetail: selected === null ? emptyPlanSlice() : await planSliceFor(selected),
      doctor,
      run: run ?? idleRun(runId, startedAt),
      budget: budget ?? idleBudget(),
      violations: [],
      socket,
      gates: 0,
      keys: modelCount(config),
      logs: log.entries(),
    });
  };

  /**
   * Run the opening plan and report progress as it completes.
   *
   * Does not start until the socket is bound. A run reaches a real provider
   * and incurs real cost; starting before bind means a daemon that fails on
   * `EADDRINUSE` — a common outcome when an operator names a port — would
   * leave a live run going with no session watching it and no handle able to
   * stop it. The operator reads "address already in use", concludes nothing
   * started, and the provider bill says otherwise.
   *
   * @param {Dispatcher} dispatch - The consumer's dispatcher.
   * @param {string | null} planPath - Plan to release; null throw.
   * @returns {Promise<void>} Settles when the run completes.
   */
  const release = async (dispatch: Dispatcher, planPath: string | null): Promise<void> => {
    if (planPath === null) {
      throw new Error('cannot release a herd: no plan was named to run');
    }
    const at = runtime.now();
    const id = at.slice(11, 19).replace(/:/g, '-');
    const tracker = trackRun(id, at);
    const report = await dispatch((await loadPlan(planPath)).plan, (event) => {
      run = tracker.apply(event);
      bus.publish('run', run);
    });
    // Finished result is authoritative. The tracker reports only what it was
    // told, and a dispatcher that reports nothing must still end correctly.
    run = toRunProgress(report.result, id, at);
    budget = report.usage;
    bus.publish('run', run);
    bus.publish('budget', budget);
  };

  /**
   * Fold one external-herd event — a `paw swarm run` in another process
   * reporting over HTTP. One tracker per run id; a new id replaces the shown
   * run. An event without a member number and key answers false and changes
   * nothing.
   */
  let externalId: string | null = null;
  let externalTracker: ReturnType<typeof trackRun> | null = null;
  const reportRun = (id: string, at: string, event: Record<string, unknown>): boolean => {
    if (typeof event.member !== 'number' || typeof event.key !== 'string') {
      return false;
    }
    if (externalId !== id || externalTracker === null) {
      externalId = id;
      externalTracker = trackRun(id, at);
    }
    run = externalTracker.apply(event as never);
    bus.publish('run', run);
    return true;
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

  // Pollers already run by the time socket bound, and bind can fail — a port
  // operator named often already taken. Leave two intervals behind on that path
  // mean daemon that fail to start still read the process table every three
  // seconds for the life of process.
  let server: ServerHandle;
  try {
    server = await runtime.listen(
      async (request) =>
        route(request, {
          page,
          snapshot,
          tree: () => tree,
          config: () => ({
            models: Object.keys((config.models as Record<string, unknown> | undefined) ?? {}),
            roles: (config.roles as Record<string, string> | undefined) ?? {},
          }),
          token,
          port: boundPort,
          scriptHashes,
          origins,
          control: options.control,
          reportRun,
          ...(options.providers === undefined ? {} : { providers: options.providers }),
          ...(recentRoutes === undefined
            ? {}
            : {
                recent: () => recentRoutes.list(),
                forgetRecent: (route: string) => recentRoutes.remove(route),
              }),
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

  // Now, no line earlier — see `release`. Grab the rejection immediately
  // because caller cannot attach a handler until this function return, and
  // unclaimed rejection exit the process.
  const dispatched = options.dispatch ? release(options.dispatch, openedOn) : null;
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
    release: async (settings: RunSettings): Promise<void> => {
      if (options.dispatcherFor === undefined) {
        throw new Error('this daemon cannot build a release dispatcher');
      }
      await release(options.dispatcherFor(settings), settings.plan);
    },
    snapshot,
    rescope,
    close: async () => {
      stopHostTicker();
      stopPolling();
      // Sessions are told why before the socket closes. A console closed with
      // the shutdown code stops retrying, whereas an abrupt drop reconnects.
      sessions.shutdown();
      await server.close();
    },
  };
}
