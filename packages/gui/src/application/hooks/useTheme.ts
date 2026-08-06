/**
 * PAW Console Theme
 *
 * @fileoverview Owns the one piece of state that lives outside React: the
 * `data-theme` attribute on the document element, which the stylesheet's token
 * blocks key off and which a boot script sets before first paint to avoid a
 * flash. The hook reads that attribute rather than keeping a duplicate, so the
 * toggle can never disagree with the page it is toggling.
 *
 * @module @paw/gui/application/hooks/useTheme
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useCallback, useState } from 'react';

/**
 * The two themes the stylesheet defines.
 */
export type Theme = 'dark' | 'light';

/**
 * The theme control.
 *
 * @interface ThemeControl
 * @property {Theme} theme - The theme in force.
 * @property {() => void} toggle - Flip between dark and light.
 */
export interface ThemeControl {
  readonly theme: Theme;
  readonly toggle: () => void;
}

/**
 * Read the theme currently stamped on the document, defaulting to dark — the
 * console's home state, and what the boot script writes when it cannot ask the
 * OS.
 *
 * @returns {Theme} The stamped theme.
 */
function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * Track and flip the document theme.
 *
 * @returns {ThemeControl} The current theme and its toggle.
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
