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
  buildRegistry,
  type BudgetSummary,
  type DispatchResult,
  type HostInfo,
  type HostProcess,
  type ModelPort,
  type PawSnapshot,
  type RunProgress,
  type SwarmPlan,
} from '@paw/core';
import type { ServerIdentity } from './identityStore.js';
import { discoverPlans, findConfig, selectPlan } from './plans.js';
import { route, type HttpRequest, type HttpResponse } from './router.js';
import { allowedOrigins } from './security.js';
import { toRunProgress } from './run.js';
import { buildSnapshot } from './snapshot.js';
import { buildFileTree, type FileEntry } from './tree.js';

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
  randomToken(): string;
  identity(): Promise<ServerIdentity>;
  readPage(): Promise<string>;
  listen(
    handler: (request: HttpRequest) => Promise<HttpResponse>,
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
 */
export type Dispatcher = (plan: SwarmPlan<unknown>) => Promise<RunReport>;

/**
 * What to serve.
 *
 * @interface DaemonOptions
 * @property {string} [root] - The repository to serve; defaults to the working directory.
 * @property {string} [configPath] - An explicit config path; otherwise `.paw/config.json` is used when the repo has one.
 * @property {string} [planPath] - A plan to open on; otherwise the console opens with none selected.
 * @property {number} [port] - Port to bind; 0 (the default) takes an ephemeral one.
 * @property {number} [pollMs] - How often to re-read the process table, tree, and plan list.
 * @property {readonly string[]} [allowOrigins] - Extra origins permitted to call the API, e.g. a GUI development server.
 * @property {Dispatcher} [dispatch] - Release the opening plan's herd once, and report the run live.
 */
export interface DaemonOptions {
  readonly root?: string;
  readonly configPath?: string;
  readonly planPath?: string;
  readonly port?: number;
  readonly pollMs?: number;
  readonly allowOrigins?: readonly string[];
  readonly dispatch?: Dispatcher;
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
 * @property {string[]} plans - The plans discovered in it.
 * @property {string | null} openedOn - The plan the daemon opened on, if any.
 * @property {Promise<void> | null} dispatched - Settles when a released herd finishes; null when no run was asked for. Rejects loudly if the run failed.
 * @property {(plan?: string | null) => Promise<PawSnapshot>} snapshot - The current snapshot for a plan, read live.
 * @property {() => Promise<void>} close - Stop polling and stop listening.
 */
export interface DaemonHandle {
  readonly url: string;
  readonly port: number;
  readonly root: string;
  readonly token: string;
  readonly identity: ServerIdentity;
  readonly plans: readonly string[];
  readonly openedOn: string | null;
  readonly dispatched: Promise<void> | null;
  snapshot(plan?: string | null): Promise<PawSnapshot>;
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
  const root = options.root ?? '.';
  let entries = await runtime.listFiles(root);
  let plans = discoverPlans(entries);
  let tree = buildFileTree(entries);

  const configPath = findConfig(options.configPath, entries);
  const config =
    configPath === ''
      ? {}
      : (JSON.parse(await runtime.readFile(underRoot(root, configPath))) as Record<
          string,
          unknown
        >);

  const page = await runtime.readPage();
  // Before anything is scheduled or bound: a daemon with no usable identity has
  // nothing to serve, and failing here leaves no poller and no socket behind.
  const identity = await runtime.identity();
  const registry = buildRegistry(config, () => REFUSING_MODEL);
  const startedAt = runtime.now();
  const runId = startedAt.slice(11, 19).replace(/:/g, '-');
  const port = options.port ?? 0;

  const loaded = new Map<string, LoadedPlan>();

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

  let processes = await runtime.listProcesses();
  const stopPolling = runtime.schedule(() => {
    void runtime.listProcesses().then((next) => {
      processes = next;
    });
    void runtime.listFiles(root).then((next) => {
      entries = next;
      plans = discoverPlans(next);
      tree = buildFileTree(next);
    });
  }, options.pollMs ?? PROCESS_POLL_MS);

  const openedOn = selectPlan(options.planPath ?? null, plans);

  let run: RunProgress | undefined;
  let budget: BudgetSummary | undefined;
  let socket = `${LOOPBACK}:${port}`;
  const snapshot = async (asked: string | null = openedOn): Promise<PawSnapshot> => {
    const selected = selectPlan(asked, plans);
    const current = selected === null ? null : await loadPlan(selected);
    return buildSnapshot({
      host: runtime.readHost(),
      processes,
      config,
      configPath,
      plans,
      selectedPlan: selected,
      plan: current === null ? null : current.plan,
      planSource: current === null ? '' : current.source,
      registry,
      knownConnectors: KNOWN_CONNECTORS,
      socket,
      violations: [],
      gates: 0,
      keys: modelCount(config),
      runId,
      startedAt,
      run,
      budget,
    });
  };

  const dispatched = options.dispatch
    ? (async (dispatch: Dispatcher): Promise<void> => {
        if (openedOn === null) {
          throw new Error('cannot release a herd: no plan was named to run');
        }
        const report = await dispatch((await loadPlan(openedOn)).plan);
        run = toRunProgress(report.result, runId, startedAt);
        budget = report.usage;
      })(options.dispatch)
    : null;

  const token = runtime.randomToken();
  let boundPort = port;
  let origins = allowedOrigins(port, options.allowOrigins);

  const server = await runtime.listen(
    async (request) =>
      route(request, {
        page,
        snapshot,
        tree: () => tree,
        token,
        port: boundPort,
        origins,
      }),
    port,
    LOOPBACK,
    { cert: identity.cert, key: identity.key },
  );
  boundPort = server.port;
  origins = allowedOrigins(server.port, options.allowOrigins);
  socket = `${LOOPBACK}:${server.port}`;

  return {
    url: `https://${socket}/`,
    port: server.port,
    root,
    token,
    identity,
    plans,
    openedOn,
    dispatched,
    snapshot,
    close: async () => {
      stopPolling();
      await server.close();
    },
  };
}
