/**
 * PAW GUI Browser Shell
 *
 * @fileoverview The driving side of the hexagon in the browser, and nothing
 * more: resolve where the data comes from, mount {@link ConsoleApp} into `#app`,
 * and get out of the way. It holds no rules and is excluded from unit coverage —
 * it is the DOM/boot shell, the browser counterpart of the CLI's process shell —
 * while everything it composes is unit-tested to 100%. A boot that fails paints
 * the reason into the page and rethrows: a console that cannot reach its daemon
 * says so instead of showing an empty window.
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
 * Resolve the snapshot and mount the console.
 */
async function mount(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) {
    throw new Error('PAW console: #app mount point is missing');
  }
  const { snapshot, source, connect, treeSource, config, token } = await boot(
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
      controls={windowControls(window as ShellWindow)}
    />,
  );
}

void mount().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  document.body.textContent = `PAW console failed to start: ${message}`;
  throw err;
});
