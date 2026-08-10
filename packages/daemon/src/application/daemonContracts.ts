/**
 * PAW Daemon Contracts
 *
 * @fileoverview The ports and value types the daemon composition is written over:
 * the runtime it drives every effect through, the socket hooks the wire adapter
 * fills, the options it takes, the handle it returns, and the small pure helpers
 * the composition shares. `DaemonRuntime` is the seam that lets the whole of
 * `runDaemon` be unit-tested against fakes while `nodeRuntime` supplies the real
 * effects — and lets `paw ui` and Electron run the daemon in their own process
 * rather than spawning a second one.
 *
 * @module @paw/daemon/application/daemonContracts
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  BudgetSummary,
  DispatchEvent,
  DispatchHookDeps,
  DispatchResult,
  HostInfo,
  HostProcess,
  InitMode,
  ModelPort,
  PawSnapshot,
  RunSettings,
  SwarmPlan,
} from '@paw/core';
import type { LiveBus } from '../domain/bus.js';
import type { ControlPort } from '../domain/control.js';
import type { HttpRequest, HttpResponse } from '../domain/router.js';
import type { WsSessionPort } from '../domain/session.js';
import type { FileEntry } from '../domain/tree.js';
import type { ServerIdentity } from '../infrastructure/identityStore.js';
import type { UpgradeRefusal } from '../infrastructure/security.js';

/** The loopback address the daemon binds; the control API is local-only. */
export const LOOPBACK = '127.0.0.1';

/** How often the process table, file tree, and plan list are re-read, in ms. */
export const PROCESS_POLL_MS = 3000;

/** How often host facts are re-read and published — also the liveness tick. */
export const HOST_TICK_MS = 1000;

/**
 * Whether two slice values are the same, by value — a fresh array of identical
 * rows is not news, and publishing it anyway is the waste this avoids.
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
 * The port every role is bound to while the daemon is only reporting. It builds a
 * registry so the doctor can judge a role's model, and never dispatches — so a
 * call here means something asked the reporting daemon to spend tokens, and it
 * refuses loudly instead of returning an empty completion a caller would trust.
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
 * The daemon's half of the WebSocket handshake, injected into the runtime. Split
 * in two on purpose: `check` runs while still plain HTTP — the cheap place to
 * refuse — and `accept` runs only after the upgrade succeeded.
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
 * @property {Function} listen - Bind a TLS server.
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
 * Releases the plan's herd. Supplied by the consumer, because choosing the model a
 * run is dispatched against is a composition decision the reporting daemon takes
 * no part in. The second argument is how the run reports itself while it happens.
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
 * @property {readonly string[]} [allowOrigins] - Extra origins permitted to call the API.
 * @property {Dispatcher} [dispatch] - Release the opening plan's herd once, and report the run live.
 * @property {string} [scopeCeiling] - Permit consoles to re-scope the daemon, within this directory.
 * @property {(path: string, mode: InitMode) => void} [onAttach] - Receive attach requests; the daemon never writes.
 * @property {(settings: RunSettings) => void} [onRelease] - Receive release requests; the daemon never runs them itself.
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
  readonly control?: ControlPort;
  readonly enforcement?: EnforcementScope;
  onAttach?(path: string, mode: InitMode): void;
  onRelease?(settings: RunSettings): void;
}

/**
 * The enforcement half of a unified daemon: the socket to claim and the deps to
 * serve hooks against, produced only after the claim so a daemon that loses the
 * race opens no store. Optional — a console-only daemon omits it.
 *
 * @interface EnforcementScope
 * @property {string} socketPath - The enforcement endpoint to claim.
 * @property {() => Promise<{ token: string; deps: DispatchHookDeps }>} configure - Produce the token and dispatch deps, run only after the claim.
 * @property {{ pid: number; now: () => number; onStop: () => void }} [control] - Enables daemon.status/stop over the socket.
 */
export interface EnforcementScope {
  readonly socketPath: string;
  configure(): Promise<{ token: string; deps: DispatchHookDeps }>;
  readonly control?: { pid: number; now: () => number; onStop: () => void };
}

/**
 * A running daemon.
 *
 * @interface DaemonHandle
 * @property {string} url - The URL the console is served at.
 * @property {number} port - The bound port.
 * @property {string} root - The repository being served.
 * @property {string} token - The per-boot credential every API call must present.
 * @property {ServerIdentity} identity - The TLS identity it is serving with.
 * @property {LiveBus} bus - Where the sources publish; what a live session subscribes to.
 * @property {string[]} plans - The plans discovered in it.
 * @property {string | null} openedOn - The plan the daemon opened on, if any.
 * @property {Promise<void> | null} dispatched - Settles when a released herd finishes; null when no run was asked for.
 * @property {(plan?: string | null) => Promise<PawSnapshot>} snapshot - The current snapshot for a plan, read live.
 * @property {(path: string) => Promise<void>} rescope - Point the daemon at another repository and republish.
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
