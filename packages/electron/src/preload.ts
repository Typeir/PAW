/**
 * PAW Electron Preload
 *
 * @fileoverview The window's sole bridge to the main process. Running sandboxed,
 * it exposes one frozen `paw` object on the isolated world: a version and
 * platform tag, and the three window controls the console's titlebar drives —
 * because the desktop window is frameless and that titlebar *is* the window's.
 * Each control is a fixed, named request over one channel; the page cannot name
 * an arbitrary action, and no filesystem, network, or general IPC surface is
 * granted. The presence of these functions is also how the console knows which
 * shell it is in: a browser tab gets no bridge, so it draws no window chrome.
 * Authored in TypeScript and compiled to CommonJS (`dist/preload.cjs`) because a
 * sandboxed preload cannot be an ES module.
 *
 * @module @paw/electron/preload
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * The channel every window request travels on.
 */
const CHANNEL = 'paw:window';

/**
 * The read-only surface exposed to the page as `window.paw`. Frozen so the page
 * cannot mutate it.
 *
 * @constant
 */
const paw = Object.freeze({
  version: process.versions.electron ?? '0.0.0',
  platform: process.platform,
  minimize: () => void ipcRenderer.invoke(CHANNEL, 'minimize'),
  maximize: () => void ipcRenderer.invoke(CHANNEL, 'maximize'),
  close: () => void ipcRenderer.invoke(CHANNEL, 'close'),
});

contextBridge.exposeInMainWorld('paw', paw);
