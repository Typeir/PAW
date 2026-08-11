/**
 * PAW GUI — Public API
 *
 * @fileoverview Shell need this to put console on screen: app
 * component, boot resolution pick between live daemon and
 * injected snapshot, and domain types host maybe want name. Internals —
 * atoms, views, hooks — stay private to module.
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
