/**
 * PAW Electron Preload
 *
 * @fileoverview Window bridge to main process. Run sandboxed. Expose one frozen `paw` object on isolated world: version and platform tag, plus three window controls minimize, maximize, close. Desktop window frameless; titlebar part of window. Each control a fixed, named request over one channel. Page has no arbitrary action, no filesystem, no network, no general IPC surface. Renderer detects shell by presence of `paw` functions: browser tab has no bridge, so renders no window chrome. Written in TypeScript, compile to CommonJS (`dist/preload.cjs`), because sandboxed preload cannot be an ES module.
 *
 * @module @paw/electron/preload
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Channel for window requests.
 */const CHANNEL = 'paw:window';

/**
 * Read-only surface expose to page as `window.paw`. Frozen, page no mutate it.
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
