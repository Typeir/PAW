/**
 * PAW Console Context
 *
 * @fileoverview Composition root of React tree. Panels take no props they do not own. State and dispatch live in context. Rail item, scrubber, herd row read exact slice via hook. State and dispatch are separate contexts so component that only dispatches does not re-render when unrelated state changes. Provider given a snapshot source polls `pawd`, applies each new snapshot through reducer's `refresh`, and surfaces any failure as an error the shell renders; an unreported polling failure would leave stale snapshot data shown as current.
 *
 * @module @paw/gui/application/context/consoleContext
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { LiveEnvelope, PawSnapshot } from '@paw/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ActionDispatch,
  type Context,
  type ReactNode,
} from 'react';
import type { RunSettings } from '@paw/core';
import type { ConsoleAction, ConsoleData, ConsoleState } from '../../domain/console.types.js';
import { initialState, reduce } from '../../domain/consoleState.js';
import { applyLiveEvent } from '../applyLiveEvent.js';
import { hydrate } from '../hydrateSnapshot.js';
import { useLiveRefresh, type SnapshotSource } from '../hooks/useLiveRefresh.js';
import { useLiveWire, type LiveMode } from '../hooks/useLiveWire.js';
import type { SocketFactory } from '../../infrastructure/liveSocket.js';
import type { TreeSource } from '../../infrastructure/snapshotSource.js';
import type { ConfigClient } from '../../infrastructure/configClient.js';
import type { RecentClient } from '../../infrastructure/recentClient.js';
import type { Shell, WindowControls } from '../../infrastructure/shell.js';

/**
 * Dispatch function reducer expose to tree.
 */
export type ConsoleDispatch = ActionDispatch<[action: ConsoleAction]>;

/**
 * Live-wire error, boxed so "no provider" (null) stay distinct from "provider present, nothing wrong" (box holding null).
 *
 * @interface LiveError
 * @property {string | null} message - Last refresh failure, or null when healthy.
 */
export interface LiveError {
  readonly message: string | null;
}

/**
 * How console connected. What it can do about it.
 *
 * @interface LiveStatus
 * @property {LiveMode} mode - Where connection is.
 * @property {string | null} message - Last polling failure, or null.
 * @property {() => void} retryNow - Reconnect immediately.
 */
export interface LiveStatus {
  readonly mode: LiveMode;
  readonly message: string | null;
  retryNow(): void;
}

/**
 * Tree source, boxed so "no provider" (null) stay distinct from "provider present, static page with no repository" (box holding null).
 *
 * @interface TreeAccess
 * @property {TreeSource | null} source - Repository tree source, or null when static.
 */
export interface TreeAccess {
  readonly source: TreeSource | null;
}

/**
 * Binding editor's client, boxed so "no provider" (null) stay distinct from "provider present, static page with no daemon to edit" (box holding null).
 *
 * @interface ConfigAccess
 * @property {ConfigClient | null} client - Config client, or null when static.
 */
export interface ConfigAccess {
  readonly client: ConfigClient | null;
}

/**
 * Operator verbs over live socket, plus recent-routes client: grab switches daemon
 * to a route, release asks daemon run a herd (operator approve in terminal). All
 * boxed so "no provider" (null client) stay distinct from static page.
 *
 * @interface ScopeAccess
 * @property {RecentClient | null} recent - Recent-routes client, or null when static.
 * @property {(path: string) => void} grab - Switch daemon to a route; no-op until socket live.
 * @property {(settings: RunSettings) => void} release - Ask daemon release herd; no-op until socket live.
 */
export interface ScopeAccess {
  readonly recent: RecentClient | null;
  grab(path: string): void;
  release(settings: RunSettings): void;
}

/**
 * Shell console run in. Window it may control.
 *
 * @interface ShellAccess
 * @property {Shell} shell - `desktop` when console own window, else `web`.
 * @property {WindowControls | null} controls - Window controls, or null in browser.
 */
export interface ShellAccess {
  readonly shell: Shell;
  readonly controls: WindowControls | null;
}

const StateContext = createContext<ConsoleState | null>(null);
const DispatchContext = createContext<ConsoleDispatch | null>(null);
const ErrorContext = createContext<LiveError | null>(null);
const LiveContext = createContext<LiveStatus | null>(null);
const TreeContext = createContext<TreeAccess | null>(null);
const ConfigContext = createContext<ConfigAccess | null>(null);
const ScopeContext = createContext<ScopeAccess | null>(null);
const ShellContext = createContext<ShellAccess | null>(null);

/**
 * Read required context. Throw when component mounts outside a provider.
 *
 * @param {Context<T | null>} context - Context to read.
 * @param {string} hook - Calling hook's name, for error message.
 * @returns {T} Context value.
 */
function useRequired<T>(context: Context<T | null>, hook: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`PAW console: ${hook}() used outside <ConsoleProvider>`);
  }
  return value;
}

/**
 * Props for {@link ConsoleProvider}.
 *
 * @interface ConsoleProviderProps
 * @property {PawSnapshot} snapshot - Snapshot to boot from.
 * @property {SnapshotSource | null} [source] - Polling source. Use only while socket down. Omit for static page.
 * @property {SocketFactory | null} [connect] - Open live socket. Omit for static page.
 * @property {string | null} [token] - Credential this tab adopt.
 * @property {TreeSource | null} [treeSource] - Repository tree source. Omit for static page.
 * @property {ConfigClient | null} [config] - Binding editor's client. Omit for static page.
 * @property {RecentClient | null} [recent] - Scope picker's recent-routes client. Omit for static page.
 * @property {WindowControls | null} [controls] - Desktop window's controls. Omit in browser.
 * @property {number} [intervalMs] - Poll period in milliseconds, for degraded mode.
 * @property {ReactNode} children - Console tree.
 */
export interface ConsoleProviderProps {
  readonly snapshot: PawSnapshot;
  readonly source?: SnapshotSource | null;
  readonly connect?: SocketFactory | null;
  readonly token?: string | null;
  readonly treeSource?: TreeSource | null;
  readonly config?: ConfigClient | null;
  readonly recent?: RecentClient | null;
  readonly controls?: WindowControls | null;
  readonly intervalMs?: number;
  readonly children: ReactNode;
}

/**
 * Default poll period in degraded mode. 3000 ms refreshes uptime, memory, and
 * process-table displays while leaving CPU cycles free for an active run.
 */
export const DEFAULT_POLL_MS = 3000;

/**
 * Provide console state, dispatch, live-refresh health to tree.
 *
 * @param {ConsoleProviderProps} props - Provider props.
 * @returns {JSX.Element} Provided tree.
 */
export function ConsoleProvider({
  snapshot,
  source = null,
  connect = null,
  token = null,
  treeSource = null,
  config = null,
  recent = null,
  controls = null,
  intervalMs = DEFAULT_POLL_MS,
  children,
}: ConsoleProviderProps) {
  const [state, dispatch] = useReducer(reduce, snapshot, (s) => initialState(hydrate(s)));
  const onSnapshot = useCallback(
    (data: ConsoleData) => dispatch({ type: 'refresh', data }),
    [dispatch],
  );

  // Socket events deliver one slice per message. Reducer folds each snapshot from
  // data as it now stands, not from React's last render; two events arriving in
  // the same tick drop the first if read from state.
  const dataRef = useRef(state.data);
  useEffect(() => {
    dataRef.current = state.data;
  }, [state.data]);

  const onEvent = useCallback(
    (event: LiveEnvelope) => {
      const next = applyLiveEvent(dataRef.current, event);
      dataRef.current = next;
      dispatch({ type: 'refresh', data: next });
    },
    [dispatch],
  );

  const wire = useLiveWire({ connect, token, plan: state.plan, onEvent });

  // `static` mean no daemon behind page at all. Page with daemon but no socket to
  // it — env without WebSocket — degraded, no static. Otherwise show boot snapshot
  // unchanged.
  const mode = connect === null && source !== null ? 'degraded' : wire.mode;

  // Polling runs only in degraded mode. While the socket is live the console makes
  // no polling requests.
  const message = useLiveRefresh(
    mode === 'degraded' ? source : null,
    intervalMs,
    state.plan,
    onSnapshot,
  );

  const live = useMemo<LiveStatus>(
    () => ({ mode, message, retryNow: wire.retryNow }),
    [mode, wire.retryNow, message],
  );
  const tree = useMemo<TreeAccess>(() => ({ source: treeSource }), [treeSource]);
  const configAccess = useMemo<ConfigAccess>(() => ({ client: config }), [config]);
  const scopeAccess = useMemo<ScopeAccess>(
    () => ({ recent, grab: wire.scope, release: wire.release }),
    [recent, wire.scope, wire.release],
  );
  const shell = useMemo<ShellAccess>(
    () => ({ shell: controls === null ? 'web' : 'desktop', controls }),
    [controls],
  );

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <ErrorContext.Provider value={{ message }}>
          <LiveContext.Provider value={live}>
            <TreeContext.Provider value={tree}>
              <ConfigContext.Provider value={configAccess}>
                <ScopeContext.Provider value={scopeAccess}>
                  <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>
                </ScopeContext.Provider>
              </ConfigContext.Provider>
            </TreeContext.Provider>
          </LiveContext.Provider>
        </ErrorContext.Provider>
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

/**
 * Whole console state.
 *
 * @returns {ConsoleState} Current state.
 */
export function useConsoleState(): ConsoleState {
  return useRequired(StateContext, 'useConsoleState');
}

/**
 * Console's dispatch.
 *
 * @returns {ConsoleDispatch} Dispatch function.
 */
export function useConsoleDispatch(): ConsoleDispatch {
  return useRequired(DispatchContext, 'useConsoleDispatch');
}

/**
 * Last live-refresh failure, or null when wire healthy.
 *
 * @returns {string | null} Error message.
 */
export function useLiveError(): string | null {
  return useRequired(ErrorContext, 'useLiveError').message;
}

/**
 * How console connected. How to reconnect it.
 *
 * @returns {LiveStatus} Connection status.
 */
export function useLiveStatus(): LiveStatus {
  return useRequired(LiveContext, 'useLiveStatus');
}

/**
 * Repository tree source, or null when page have no daemon behind it.
 *
 * @returns {TreeSource | null} Tree source.
 */
export function useTreeSource(): TreeSource | null {
  return useRequired(TreeContext, 'useTreeSource').source;
}

/**
 * Binding editor's client, or null when page have no daemon behind it.
 *
 * @returns {ConfigClient | null} Config client.
 */
export function useConfigClient(): ConfigClient | null {
  return useRequired(ConfigContext, 'useConfigClient').client;
}

/**
 * Scope picker's client and grab action that switches daemon to a route.
 *
 * @returns {ScopeAccess} Recent client and grab.
 */
export function useScope(): ScopeAccess {
  return useRequired(ScopeContext, 'useScope');
}

/**
 * Shell console run in. Window it may control.
 *
 * @returns {ShellAccess} Shell and its window controls.
 */
export function useShell(): ShellAccess {
  return useRequired(ShellContext, 'useShell');
}
