/**
 * PAW Console Shell Detection
 *
 * @fileoverview Which shell the console is running in, and what that shell lets
 * it do. A desktop shell owns a real window: it hands the page a bridge with
 * minimise/maximise/close, and the console then draws the window's titlebar
 * because it *is* the titlebar. A browser tab owns no window, so the console
 * draws no window chrome there — a page with painted traffic lights and a
 * rounded "window" floating on a desk is a costume, and the buttons on it do
 * nothing. The console asks the shell rather than guessing from the URL, and it
 * treats a bridge without working controls as no bridge at all, so a light is
 * only ever drawn when pressing it does something.
 *
 * @module @paw/gui/infrastructure/shell
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * What a desktop shell exposes to the page.
 *
 * @interface PawBridge
 * @property {string} [version] - The shell's version.
 * @property {string} [platform] - The host platform.
 * @property {() => void} [minimize] - Minimise the window.
 * @property {() => void} [maximize] - Maximise or restore the window.
 * @property {() => void} [close] - Close the window.
 */
export interface PawBridge {
  readonly version?: string;
  readonly platform?: string;
  minimize?(): void;
  maximize?(): void;
  close?(): void;
}

/**
 * The window a shell may have injected a bridge into.
 *
 * @interface ShellWindow
 * @property {PawBridge} [paw] - The desktop bridge, when there is one.
 */
export interface ShellWindow {
  paw?: PawBridge;
}

/**
 * Where the console is running: inside a window it controls, or in a browser.
 */
export type Shell = 'desktop' | 'web';

/**
 * The window controls a desktop shell provides.
 *
 * @interface WindowControls
 * @property {() => void} minimize - Minimise the window.
 * @property {() => void} maximize - Maximise or restore the window.
 * @property {() => void} close - Close the window.
 */
export interface WindowControls {
  minimize(): void;
  maximize(): void;
  close(): void;
}

/**
 * The window controls, or null when nothing can actually drive a window.
 *
 * @param {ShellWindow} win - The window to read the bridge from.
 * @returns {WindowControls | null} The controls, or null in a browser.
 */
export function windowControls(win: ShellWindow): WindowControls | null {
  const bridge = win.paw;
  if (
    !bridge ||
    typeof bridge.minimize !== 'function' ||
    typeof bridge.maximize !== 'function' ||
    typeof bridge.close !== 'function'
  ) {
    return null;
  }
  return {
    minimize: () => bridge.minimize?.(),
    maximize: () => bridge.maximize?.(),
    close: () => bridge.close?.(),
  };
}

/**
 * Which shell the console is in.
 *
 * @param {ShellWindow} win - The window to inspect.
 * @returns {Shell} `desktop` when a window bridge is present and usable, else `web`.
 */
export function detectShell(win: ShellWindow): Shell {
  return windowControls(win) === null ? 'web' : 'desktop';
}
