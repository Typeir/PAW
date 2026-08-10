/**
 * PAW Console Context
 *
 * @fileoverview The composition root of the React tree and the reason no panel
 * takes a prop it does not own: state and dispatch live in context, and a rail
 * item, a scrubber, or a herd row reads exactly the slice it needs through a
 * hook. State and dispatch are separate contexts so a component that only
 * dispatches does not re-render when unrelated state moves. The provider also
 * owns the live wire: given a snapshot source it polls `pawd`, folds each new
 * snapshot in through the reducer's `refresh`, and publishes any failure as a
 * visible error the shell renders — a poll that died quietly would leave a stale
 * console looking live.
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
import type { ConsoleAction, ConsoleData, ConsoleState } from '../../domain/console.types.js';
import { initialState, reduce } from '../../domain/consoleState.js';
import { applyLiveEvent } from '../applyLiveEvent.js';
import { hydrate } from '../hydrateSnapshot.js';
import { useLiveRefresh, type SnapshotSource } from '../hooks/useLiveRefresh.js';
import { useLiveWire, type LiveMode } from '../hooks/useLiveWire.js';
import type { SocketFactory } from '../../infrastructure/liveSocket.js';
import type { TreeSource } from '../../infrastructure/snapshotSource.js';
import type { ConfigClient } from '../../infrastructure/configClient.js';
import type { Shell, WindowControls } from '../../infrastructure/shell.js';

/**
 * The dispatch function the reducer exposes to the tree.
 */
export type ConsoleDispatch = ActionDispatch<[action: ConsoleAction]>;

/**
 * The live-wire error, boxed so that "no provider" (null) stays distinguishable
 * from "provider present, nothing wrong" (a box holding null).
 *
 * @interface LiveError
 * @property {string | null} message - The last refresh failure, or null when healthy.
 */
export interface LiveError {
  readonly message: string | null;
}

/**
 * How the console is connected, and what it can do about it.
 *
 * @interface LiveStatus
 * @property {LiveMode} mode - Where the connection is.
 * @property {string | null} message - The last polling failure, or null.
 * @property {() => void} retryNow - Reconnect immediately.
 */
export interface LiveStatus {
  readonly mode: LiveMode;
  readonly message: string | null;
  retryNow(): void;
}

/**
 * The tree source, boxed so that "no provider" (null) stays distinguishable
 * from "provider present, static page with no repository" (a box holding null).
 *
 * @interface TreeAccess
 * @property {TreeSource | null} source - The repository tree source, or null when static.
 */
export interface TreeAccess {
  readonly source: TreeSource | null;
}

/**
 * The binding editor's client, boxed so "no provider" (null) stays distinct from
 * "provider present, static page with no daemon to edit" (a box holding null).
 *
 * @interface ConfigAccess
 * @property {ConfigClient | null} client - The config client, or null when static.
 */
export interface ConfigAccess {
  readonly client: ConfigClient | null;
}

/**
 * The shell the console is running in, and the window it may control.
 *
 * @interface ShellAccess
 * @property {Shell} shell - `desktop` when the console owns the window, else `web`.
 * @property {WindowControls | null} controls - The window controls, or null in a browser.
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
const ShellContext = createContext<ShellAccess | null>(null);

/**
 * Read a required context, failing loud when a component is mounted outside the
 * provider rather than rendering an empty console.
 *
 * @param {Context<T | null>} context - The context to read.
 * @param {string} hook - The calling hook's name, for the error message.
 * @returns {T} The context value.
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
 * @property {PawSnapshot} snapshot - The snapshot to boot from.
 * @property {SnapshotSource | null} [source] - The polling source, used only while the socket is down; omit for a static page.
 * @property {SocketFactory | null} [connect] - Opens the live socket; omit for a static page.
 * @property {string | null} [token] - The credential this tab adopted.
 * @property {TreeSource | null} [treeSource] - The repository tree source; omit for a static page.
 * @property {ConfigClient | null} [config] - The binding editor's client; omit for a static page.
 * @property {WindowControls | null} [controls] - The desktop window's controls; omit in a browser.
 * @property {number} [intervalMs] - Poll period in milliseconds, for degraded mode.
 * @property {ReactNode} children - The console tree.
 */
export interface ConsoleProviderProps {
  readonly snapshot: PawSnapshot;
  readonly source?: SnapshotSource | null;
  readonly connect?: SocketFactory | null;
  readonly token?: string | null;
  readonly treeSource?: TreeSource | null;
  readonly config?: ConfigClient | null;
  readonly controls?: WindowControls | null;
  readonly intervalMs?: number;
  readonly children: ReactNode;
}

/**
 * The default poll period: fast enough that uptime, memory, and the process
 * table visibly move, slow enough to stay free next to a real run.
 */
export const DEFAULT_POLL_MS = 3000;

/**
 * Provide console state, dispatch, and live-refresh health to the tree.
 *
 * @param {ConsoleProviderProps} props - The provider props.
 * @returns {JSX.Element} The provided tree.
 */
export function ConsoleProvider({
  snapshot,
  source = null,
  connect = null,
  token = null,
  treeSource = null,
  config = null,
  controls = null,
  intervalMs = DEFAULT_POLL_MS,
  children,
}: ConsoleProviderProps) {
  const [state, dispatch] = useReducer(reduce, snapshot, (s) => initialState(hydrate(s)));
  const onSnapshot = useCallback(
    (data: ConsoleData) => dispatch({ type: 'refresh', data }),
    [dispatch],
  );

  // The live wire delivers one slice at a time, so folding needs the data as it
  // is *now*, not as it was when React last rendered: two frames can arrive in a
  // single tick, and reading state there would silently drop the first.
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

  // `static` means no daemon behind the page at all. A page that has a daemon
  // but no socket to it — an environment without WebSocket — is degraded, not
  // static, or it would sit there showing its boot snapshot forever.
  const mode = connect === null && source !== null ? 'degraded' : wire.mode;

  // Polling is the degraded mode and nothing else: while the socket is live the
  // console makes no requests at all, which is the whole point of the exercise.
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
                <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>
              </ConfigContext.Provider>
            </TreeContext.Provider>
          </LiveContext.Provider>
        </ErrorContext.Provider>
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

/**
 * The whole console state.
 *
 * @returns {ConsoleState} The current state.
 */
export function useConsoleState(): ConsoleState {
  return useRequired(StateContext, 'useConsoleState');
}

/**
 * The console's dispatch.
 *
 * @returns {ConsoleDispatch} The dispatch function.
 */
export function useConsoleDispatch(): ConsoleDispatch {
  return useRequired(DispatchContext, 'useConsoleDispatch');
}

/**
 * The last live-refresh failure, or null when the wire is healthy.
 *
 * @returns {string | null} The error message.
 */
export function useLiveError(): string | null {
  return useRequired(ErrorContext, 'useLiveError').message;
}

/**
 * How the console is connected, and how to reconnect it.
 *
 * @returns {LiveStatus} The connection status.
 */
export function useLiveStatus(): LiveStatus {
  return useRequired(LiveContext, 'useLiveStatus');
}

/**
 * The repository tree source, or null when the page has no daemon behind it.
 *
 * @returns {TreeSource | null} The tree source.
 */
export function useTreeSource(): TreeSource | null {
  return useRequired(TreeContext, 'useTreeSource').source;
}

/**
 * The binding editor's client, or null when the page has no daemon behind it.
 *
 * @returns {ConfigClient | null} The config client.
 */
export function useConfigClient(): ConfigClient | null {
  return useRequired(ConfigContext, 'useConfigClient').client;
}

/**
 * The shell the console is running in, and the window it may control.
 *
 * @returns {ShellAccess} The shell and its window controls.
 */
export function useShell(): ShellAccess {
  return useRequired(ShellContext, 'useShell');
}
