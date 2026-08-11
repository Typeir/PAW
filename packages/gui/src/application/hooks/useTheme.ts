/**
 * PAW Console Theme
 *
 * @fileoverview Single source of truth for theme is `data-theme` attribute on
 * document element. Stylesheet token blocks key off it. Boot script sets it
 * before first paint to avoid flash. Hook reads that attribute and keeps no
 * duplicate state.
 *
 * @module @paw/gui/application/hooks/useTheme
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useCallback, useState } from 'react';

/**
 * Two themes stylesheet define.
 */
export type Theme = 'dark' | 'light';

/**
 * The theme control.
 *
 * @interface ThemeControl
 * @property {Theme} theme - Theme in force.
 * @property {() => void} toggle - Flip between dark and light.
 */
export interface ThemeControl {
  readonly theme: Theme;
  readonly toggle: () => void;
}

/**
 * Read theme currently stamped on document. Default dark — value boot
 * script writes when it cannot ask OS.
 *
 * @returns {Theme} The stamped theme.
 */
function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * Track and flip document theme.
 *
 * @returns {ThemeControl} Current theme and its toggle.
 */
export function useTheme(): ThemeControl {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const toggle = useCallback(() => {
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  }, []);
  return { theme, toggle };
}
