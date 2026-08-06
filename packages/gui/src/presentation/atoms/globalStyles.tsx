/**
 * Global Styles Atom
 *
 * @fileoverview Mounts the console's stylesheet from inside the tree, so a test
 * that renders the console renders the same page a user gets and the browser and
 * Electron shells need no separate style step.
 *
 * @module @paw/gui/presentation/atoms/globalStyles
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { STYLES } from '../styles/consoleStyles.js';

/**
 * The console stylesheet.
 *
 * @returns {JSX.Element} A style element carrying the whole sheet.
 */
export function GlobalStyles() {
  return <style data-paw='styles' dangerouslySetInnerHTML={{ __html: STYLES }} />;
}
