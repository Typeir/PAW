/**
 * Global Styles Atom
 *
 * @fileoverview Mount console stylesheet inside tree. Test that render console
 * render same page user get. Browser and Electron shells need no separate style step.
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
 * @returns {JSX.Element} Style element carry whole sheet.
 */
export function GlobalStyles() {
  return <style data-paw='styles' dangerouslySetInnerHTML={{ __html: STYLES }} />;
}
