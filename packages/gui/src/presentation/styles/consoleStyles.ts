/**
 * PAW GUI Styles
 *
 * @fileoverview Console stylesheet as one string, mounted by `GlobalStyles`: the shared `--sem-*` palette
 * from `@paw/cosmetics`, then `console.scss` compiled by dart-sass (esbuild in the build, Vite in tests).
 *
 * @module @paw/gui/presentation/styles/consoleStyles
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { cssVariables } from '@paw/cosmetics';
import sheet from './console.scss?inline';

/**
 * Full stylesheet: a `:root` rule carrying the semantic palette, then the compiled console sheet.
 *
 * @constant
 * @type {string}
 */
export const STYLES = `:root {\n${cssVariables()}\n}\n${sheet}`;
