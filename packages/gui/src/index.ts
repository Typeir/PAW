/**
 * PAW GUI — Public API
 *
 * @fileoverview What a shell needs to put the console on a screen: the app
 * component, the boot resolution that decides between a live daemon and an
 * injected snapshot, and the domain types a host might want to name. The
 * internals — atoms, views, hooks — stay private to the module.
 *
 * @module @paw/gui
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { ConsoleApp } from './presentation/consoleApp.js';
export type { ConsoleAppProps } from './presentation/consoleApp.js';

export { ConsoleProvider, DEFAULT_POLL_MS } from './application/context/consoleContext.js';
export { hydrate } from './application/hydrateSnapshot.js';
export type { SnapshotSource } from './application/hooks/useLiveRefresh.js';

export {
  boot,
  createHttpSource,
  createTreeSource,
  STATE_URL,
  TREE_URL,
} from './infrastructure/snapshotSource.js';
export type {
  Boot,
  FetchLike,
  PawWindow,
  ResponseLike,
  TreeSource,
} from './infrastructure/snapshotSource.js';

export { contextArgument, coverage, filesUnder, toggleContext } from './domain/context.js';

export { detectShell, windowControls } from './infrastructure/shell.js';
export type { PawBridge, Shell, ShellWindow, WindowControls } from './infrastructure/shell.js';

export { STYLES } from './presentation/styles/consoleStyles.js';

export type {
  ConsoleAction,
  ConsoleData,
  ConsoleState,
  PlanView,
  Section,
  Tab,
} from './domain/console.types.js';
