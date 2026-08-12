/**
 * PAW GUI Browser Shell
 *
 * @fileoverview Browser entry point. Resolve where data come from, mount
 * {@link ConsoleApp} into `#app`, then exit. Excluded from unit coverage — DOM/boot
 * shell, browser counterpart of CLI process shell — unit tests cover the modules
 * it composes to 100%. On boot failure paint reason into page and rethrow: if
 * console cannot reach daemon, say so, no empty window.
 *
 * @module @paw/gui/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { createRoot } from 'react-dom/client';
import type { AuthWindow } from './infrastructure/auth.js';
import type { SocketWindow } from './infrastructure/liveSocket.js';
import { boot, type PawWindow } from './infrastructure/snapshotSource.js';
import { windowControls, type ShellWindow } from './infrastructure/shell.js';
import { ConsoleApp } from './presentation/consoleApp.js';

/**
 * Resolve snapshot, mount console.
 */
async function mount(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) {
    throw new Error('PAW console: #app mount point is missing');
  }
  const { snapshot, source, connect, treeSource, config, plans, recent, token } = await boot(
    window as unknown as PawWindow & AuthWindow & SocketWindow,
    (url, init) => fetch(url, init),
    window.WebSocket,
  );
  createRoot(host).render(
    <ConsoleApp
      snapshot={snapshot}
      source={source}
      connect={connect}
      token={token}
      treeSource={treeSource}
      config={config}
      plans={plans}
      recent={recent}
      controls={windowControls(window as ShellWindow)}
    />,
  );
}

void mount().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  document.body.textContent = `PAW console failed to start: ${message}`;
  throw err;
});
