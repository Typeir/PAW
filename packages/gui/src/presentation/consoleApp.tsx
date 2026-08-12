/**
 * Console App
 *
 * @fileoverview Whole console one component: stylesheet, state provider, window. A shell — browser, Electron, or test — mount this with snapshot and, when daemon sit behind page, source keep it live. Callers pass snapshot and dependencies, mount; internal wiring not exposed.
 *
 * @module @paw/gui/presentation/consoleApp
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawSnapshot } from '@paw/core';
import { ConsoleProvider } from '../application/context/consoleContext.js';
import type { SnapshotSource } from '../application/hooks/useLiveRefresh.js';
import type { SocketFactory } from '../infrastructure/liveSocket.js';
import type { TreeSource } from '../infrastructure/snapshotSource.js';
import type { ConfigClient } from '../infrastructure/configClient.js';
import type { PlansClient } from '../infrastructure/plansClient.js';
import type { RecentClient } from '../infrastructure/recentClient.js';
import type { WindowControls } from '../infrastructure/shell.js';
import { GlobalStyles } from './atoms/globalStyles.js';
import { ConsoleWindow } from './chrome/consoleWindow.js';

/**
 * Props for {@link ConsoleApp}.
 *
 * @interface ConsoleAppProps
 * @property {PawSnapshot} snapshot - Snapshot to boot from.
 * @property {SnapshotSource | null} [source] - Polling source use while socket down; omit for static page.
 * @property {SocketFactory | null} [connect] - Open live socket; omit for static page.
 * @property {string | null} [token] - Credential this tab adopt.
 * @property {TreeSource | null} [treeSource] - Repository tree source; omit for static page.
 * @property {ConfigClient | null} [config] - Binding editor client; omit for static page.
 * @property {PlansClient | null} [plans] - Plan-file write client; omit for static page.
 * @property {RecentClient | null} [recent] - Scope picker recent-routes client; omit for static page.
 * @property {WindowControls | null} [controls] - Desktop window controls; omit in browser.
 * @property {number} [intervalMs] - Poll period in milliseconds, for degraded mode.
 */
export interface ConsoleAppProps {
  readonly snapshot: PawSnapshot;
  readonly source?: SnapshotSource | null;
  readonly connect?: SocketFactory | null;
  readonly token?: string | null;
  readonly treeSource?: TreeSource | null;
  readonly config?: ConfigClient | null;
  readonly plans?: PlansClient | null;
  readonly recent?: RecentClient | null;
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
  connect,
  token,
  treeSource,
  config,
  plans,
  recent,
  controls,
  intervalMs,
}: ConsoleAppProps) {
  return (
    <ConsoleProvider
      snapshot={snapshot}
      source={source}
      connect={connect}
      token={token}
      treeSource={treeSource}
      config={config}
      plans={plans}
      recent={recent}
      controls={controls}
      intervalMs={intervalMs}>
      <GlobalStyles />
      <ConsoleWindow />
    </ConsoleProvider>
  );
}
