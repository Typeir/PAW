/**
 * Console App
 *
 * @fileoverview The whole console as one component: the stylesheet, the state
 * provider, and the window. A shell — browser, Electron, or a test — mounts this
 * with a snapshot and, when a daemon is behind the page, a source to keep it
 * live. Nothing above it needs to know how the console is put together.
 *
 * @module @paw/gui/presentation/consoleApp
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawSnapshot } from '@paw/core';
import { ConsoleProvider } from '../application/context/consoleContext.js';
import type { SnapshotSource } from '../application/hooks/useLiveRefresh.js';
import type { TreeSource } from '../infrastructure/snapshotSource.js';
import type { WindowControls } from '../infrastructure/shell.js';
import { GlobalStyles } from './atoms/globalStyles.js';
import { ConsoleWindow } from './chrome/consoleWindow.js';

/**
 * Props for {@link ConsoleApp}.
 *
 * @interface ConsoleAppProps
 * @property {PawSnapshot} snapshot - The snapshot to boot from.
 * @property {SnapshotSource | null} [source] - A live source to poll; omit for a static page.
 * @property {TreeSource | null} [treeSource] - The repository tree source; omit for a static page.
 * @property {WindowControls | null} [controls] - The desktop window's controls; omit in a browser.
 * @property {number} [intervalMs] - Poll period in milliseconds.
 */
export interface ConsoleAppProps {
  readonly snapshot: PawSnapshot;
  readonly source?: SnapshotSource | null;
  readonly treeSource?: TreeSource | null;
  readonly controls?: WindowControls | null;
  readonly intervalMs?: number;
}

/**
 * The PAW console.
 *
 * @param {ConsoleAppProps} props - The app props.
 * @returns {JSX.Element} The console.
 */
export function ConsoleApp({
  snapshot,
  source,
  treeSource,
  controls,
  intervalMs,
}: ConsoleAppProps) {
  return (
    <ConsoleProvider
      snapshot={snapshot}
      source={source}
      treeSource={treeSource}
      controls={controls}
      intervalMs={intervalMs}>
      <GlobalStyles />
      <ConsoleWindow />
    </ConsoleProvider>
  );
}
