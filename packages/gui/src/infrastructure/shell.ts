/**
 * PAW Console Shell Detection
 *
 * @fileoverview Detects which shell the console runs in: desktop or web.
 * Desktop shell owns a native window and exposes a page bridge with
 * minimise/maximise/close controls. The console draws a titlebar in
 * desktop mode because the console is the titlebar. A browser tab has no
 * window, so the console draws no window chrome there. The console queries
 * the shell; the URL carries no shell information. A bridge without all three
 * working controls is treated as
 * absent. A control light is drawn only when the action is usable.
 *
 * @module @paw/gui/infrastructure/shell
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * What desktop shell show page.
 *
 * @interface PawBridge
 * @property {string} [version] - Shell version.
 * @property {string} [platform] - Host platform.
 * @property {() => void} [minimize] - Minimise window.
 * @property {() => void} [maximize] - Maximise or restore window.
 * @property {() => void} [close] - Close window.
 */
export interface PawBridge {
  readonly version?: string;
  readonly platform?: string;
  minimize?(): void;
  maximize?(): void;
  close?(): void;
}

/**
 * Window object that may expose the desktop bridge.
 *
 * @interface ShellWindow
 * @property {PawBridge} [paw] - Desktop bridge, when there be one.
 */
export interface ShellWindow {
  paw?: PawBridge;
}

/**
 * Where console run: inside window console control, or in browser.
 */
export type Shell = 'desktop' | 'web';

/**
 * Window controls desktop shell give.
 *
 * @interface WindowControls
 * @property {() => void} minimize - Minimise window.
 * @property {() => void} maximize - Maximise or restore window.
 * @property {() => void} close - Close window.
 */
export interface WindowControls {
  minimize(): void;
  maximize(): void;
  close(): void;
}

/**
 * Window controls, or null when the bridge lacks any of the three controls.
 *
 * @param {ShellWindow} win - Window to read bridge from.
 * @returns {WindowControls | null} Controls, or null in browser.
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
 * Which shell console in.
 *
 * @param {ShellWindow} win - Window to inspect.
 * @returns {Shell} `desktop` when window bridge present and usable, else `web`.
 */
export function detectShell(win: ShellWindow): Shell {
  return windowControls(win) === null ? 'web' : 'desktop';
}
