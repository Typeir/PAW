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

import type { PawSnapshot } from '@paw/core';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ActionDispatch,
  type Context,
  type ReactNode,
} from 'react';
import type { ConsoleAction, ConsoleData, ConsoleState } from '../../domain/console.types.js';
import { initialState, reduce } from '../../domain/consoleState.js';
import { hydrate } from '../hydrateSnapshot.js';
import { useLiveRefresh, type SnapshotSource } from '../hooks/useLiveRefresh.js';
import type { TreeSource } from '../../infrastructure/snapshotSource.js';
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
const TreeContext = createContext<TreeAccess | null>(null);
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
 * @property {SnapshotSource | null} [source] - A live source to poll; omit for a static page.
 * @property {TreeSource | null} [treeSource] - The repository tree source; omit for a static page.
 * @property {WindowControls | null} [controls] - The desktop window's controls; omit in a browser.
 * @property {number} [intervalMs] - Poll period in milliseconds.
 * @property {ReactNode} children - The console tree.
 */
export interface ConsoleProviderProps {
  readonly snapshot: PawSnapshot;
  readonly source?: SnapshotSource | null;
  readonly treeSource?: TreeSource | null;
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
  treeSource = null,
  controls = null,
  intervalMs = DEFAULT_POLL_MS,
  children,
}: ConsoleProviderProps) {
  const [state, dispatch] = useReducer(reduce, snapshot, (s) => initialState(hydrate(s)));
  const onSnapshot = useCallback(
    (data: ConsoleData) => dispatch({ type: 'refresh', data }),
    [dispatch],
  );
  const message = useLiveRefresh(source, intervalMs, state.plan, onSnapshot);
  const tree = useMemo<TreeAccess>(() => ({ source: treeSource }), [treeSource]);
  const shell = useMemo<ShellAccess>(
    () => ({ shell: controls === null ? 'web' : 'desktop', controls }),
    [controls],
  );

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <ErrorContext.Provider value={{ message }}>
          <TreeContext.Provider value={tree}>
            <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>
          </TreeContext.Provider>
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
 * The repository tree source, or null when the page has no daemon behind it.
 *
 * @returns {TreeSource | null} The tree source.
 */
export function useTreeSource(): TreeSource | null {
  return useRequired(TreeContext, 'useTreeSource').source;
}

/**
 * The shell the console is running in, and the window it may control.
 *
 * @returns {ShellAccess} The shell and its window controls.
 */
export function useShell(): ShellAccess {
  return useRequired(ShellContext, 'useShell');
}
