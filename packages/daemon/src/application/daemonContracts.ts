/**
 * PAW Daemon Contracts
 *
 * @fileoverview Ports and value types daemon composition write over. Runtime drive every effect. Socket hooks wire adapter fill. Options daemon take. Handle daemon return. Pure helpers composition share. `DaemonRuntime` is the injected effect boundary. Unit-test `runDaemon` against fakes. `nodeRuntime` supply real effects. Run daemon in-process for `paw ui` and Electron.
 *
 * @module @paw/daemon/application/daemonContracts
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  BudgetSummary,
  DispatchEvent,
  DispatchResult,
  HostInfo,
  HostProcess,
  InitMode,
  LogEntry,
  ModelPort,
  PawSnapshot,
  RecentRoutesPort,
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

/** Daemon binds loopback address. Control API local-only. */
export const LOOPBACK = '127.0.0.1';

/** Process table, file tree, and plan list re-read this often, in ms. */
export const PROCESS_POLL_MS = 3000;

/** Host facts re-read and published this often. Also liveness tick. */
export const HOST_TICK_MS = 1000;

/**
 * Whether two slice values equal, by value.
 *
 * @param {unknown} previous - Last published value.
 * @param {unknown} next - Freshly read one.
 * @returns {boolean} True when nothing change.
 */
export function sameValue(previous: unknown, next: unknown): boolean {
  return JSON.stringify(previous) === JSON.stringify(next);
}

/**
 * A thrown value as message line.
 *
 * @param {unknown} error - What thrown.
 * @returns {string} The message.
 */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ModelPort bound to every role while daemon only reports state. Registry doctor reads to judge role's model. `complete` throws; it never dispatches.
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
 * @property {number} port - Port actually bound (resolved when 0 asked for).
 * @property {() => Promise<void>} close - Stop listening.
 */
export interface ServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Certificate a server present.
 *
 * @interface TlsMaterial
 * @property {string} cert - Server certificate chain, PEM.
 * @property {string} key - Its private key, PEM.
 */
export interface TlsMaterial {
  readonly cert: string;
  readonly key: string;
}

/**
 * What runtime tell daemon about socket ask to upgrade.
 *
 * @interface UpgradeContext
 * @property {string} [host] - Request's `Host`.
 * @property {string} [origin] - Request's `Origin`.
 * @property {string[]} protocols - Subprotocols it offered.
 */
export interface UpgradeContext {
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly protocols: readonly string[];
}

/**
 * What runtime drive once socket accepted.
 *
 * @interface AcceptedSocket
 * @property {(raw: string) => Promise<void>} message - One text frame arrive.
 * @property {() => void} closed - The peer go away.
 */
export interface AcceptedSocket {
  message(raw: string): Promise<void>;
  closed(): void;
}

/**
 * Daemon's half of WebSocket handshake, injected into runtime. `check` run while still plain HTTP. `accept` run only after upgrade succeed.
 *
 * @interface SocketHooks
 * @property {(context: UpgradeContext) => UpgradeRefusal | null} check - Whether upgrade at all.
 * @property {(port: WsSessionPort) => AcceptedSocket} accept - Adopt upgraded socket.
 */
export interface SocketHooks {
  check(context: UpgradeContext): UpgradeRefusal | null;
  accept(port: WsSessionPort): AcceptedSocket;
}

/**
 * Every effect daemon need, injected.
 *
 * @interface DaemonRuntime
 * @property {(path: string) => Promise<string>} readFile - Read file as UTF-8 text.
 * @property {(path: string, version: number) => Promise<unknown>} importModule - Import module, reload it when `version` change.
 * @property {(path: string) => Promise<number>} modifiedAt - File's last-modified time in milliseconds.
 * @property {() => Promise<HostProcess[]>} listProcesses - Processes PAW own.
 * @property {(root: string) => Promise<FileEntry[]>} listFiles - Repository listing under root.
 * @property {() => HostInfo} readHost - Host facts, read fresh.
 * @property {() => string} now - ISO timestamp.
 * @property {() => number} clock - Epoch milliseconds, for wire timestamps and session timers.
 * @property {(message: string) => void} warn - Report message for operator. Do not stop daemon.
 * @property {() => string} randomToken - Fresh, unguessable session token.
 * @property {() => Promise<ServerIdentity>} identity - This machine's TLS identity, issued or renewed as needed.
 * @property {() => Promise<string>} readPage - HTML serve at `/`.
 * @property {Function} listen - Bind TLS server.
 * @property {(fn, ms) => () => void} schedule - Run `fn` every `ms`. Return canceller.
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
 * What real dispatch reported back.
 *
 * @interface RunReport
 * @property {DispatchResult} result - Core's own dispatch result.
 * @property {BudgetSummary} usage - Tokens run actually spent.
 */
export interface RunReport {
  readonly result: DispatchResult;
  readonly usage: BudgetSummary;
}

/**
 * Dispatch a swarm plan. Supplied by consumer. Reporting daemon select no model. Second argument report run's progress as it happen.
 */
export type Dispatcher = (
  plan: SwarmPlan<unknown>,
  onProgress: (event: DispatchEvent) => void,
) => Promise<RunReport>;

/**
 * What to serve.
 *
 * @interface DaemonOptions
 * @property {string} [root] - Repository to serve. Defaults to working directory.
 * @property {string} [configPath] - Explicit config path. Else `.paw/config.json` use when repo have one.
 * @property {string} [planPath] - Plan to open on. Else console opens with none selected.
 * @property {number} [port] - Port to bind. 0 (default) take ephemeral one.
 * @property {number} [pollMs] - How often re-read process table, tree, config, and plan list.
 * @property {number} [hostMs] - How often re-read and publish host facts.
 * @property {readonly string[]} [allowOrigins] - Extra origins permitted to call API.
 * @property {Dispatcher} [dispatch] - Dispatch the opening plan once, and report run live.
 * @property {string} [scopeCeiling] - Permit consoles to re-scope daemon, within this directory.
 * @property {RecentRoutesPort} [recent] - Remember each scope as recent route and serve list. Omit to keep no history.
 * @property {(path: string, mode: InitMode) => void} [onAttach] - Receive attach requests. Daemon never write.
 * @property {(settings: RunSettings) => void} [onRelease] - Receive release requests. Daemon never run them itself.
 * @property {(settings: RunSettings) => Dispatcher} [dispatcherFor] - Build dispatcher for approved release settings. Shell own live registry and writers; omit and {@link DaemonHandle.release} throw.
 * @property {LogSinkLike} [logSink] - Log persistence: every report appends one entry, boot seeds the ring from the persisted tail. Omit and logs stay per-boot.
 * @property {() => readonly unknown[]} [providers] - Key-free provider roster served at `/api/providers` for the Keys view. Omit and the route answers 404.
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
  readonly recent?: RecentRoutesPort;
  readonly logSink?: LogSinkLike;
  readonly providers?: () => readonly unknown[];
  onAttach?(path: string, mode: InitMode): void;
  onRelease?(settings: RunSettings): void;
  dispatcherFor?(settings: RunSettings): Dispatcher;
}

/**
 * Log persistence a daemon writes through and boots from.
 *
 * @interface LogSinkLike
 * @property {(entry: LogEntry) => void} append - Persist one entry, best effort.
 * @property {(limit: number) => LogEntry[]} load - The newest `limit` persisted entries, oldest first.
 */
export interface LogSinkLike {
  append(entry: LogEntry): void;
  load(limit: number): LogEntry[];
}

/**
 * A running daemon.
 *
 * @interface DaemonHandle
 * @property {string} url - URL console served at.
 * @property {number} port - Bound port.
 * @property {string} root - Repository being served.
 * @property {string} token - Per-boot credential every API call must present.
 * @property {ServerIdentity} identity - TLS identity it serve with.
 * @property {LiveBus} bus - Where sources publish. What live session subscribe to.
 * @property {string[]} plans - Plans discovered in it.
 * @property {string | null} openedOn - Plan daemon opened on, if any.
 * @property {Promise<void> | null} dispatched - Resolves when the released dispatch finishes. Null when no run asked for.
 * @property {(settings: RunSettings) => Promise<void>} release - Run an approved release through the injected {@link DaemonOptions.dispatcherFor}, progress into the console; throw when no factory injected.
 * @property {(plan?: string | null) => Promise<PawSnapshot>} snapshot - Current snapshot for plan, read live.
 * @property {(path: string) => Promise<void>} rescope - Point daemon at another repository and republish.
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
  release(settings: RunSettings): Promise<void>;
  snapshot(plan?: string | null): Promise<PawSnapshot>;
  rescope(path: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Take swarm plan out of imported module. Throw when module export none.
 *
 * @param {unknown} mod - Imported module.
 * @param {string} path - Path it came from, for error message.
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
 * How many models config declare. The Keys rail count.
 *
 * @param {Record<string, unknown>} config - Parsed config.
 * @returns {number} The model count.
 */
export function modelCount(config: Record<string, unknown>): number {
  const models = config.models;
  return models !== null && typeof models === 'object' ? Object.keys(models).length : 0;
}

/**
 * Resolve repo-relative path to form runtime open.
 *
 * @param {string} root - Served repository.
 * @param {string} path - Repo-relative path.
 * @returns {string} Path to hand runtime.
 */
export function underRoot(root: string, path: string): string {
  const base = root === '' ? '.' : root.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${base}/${path}`;
}
