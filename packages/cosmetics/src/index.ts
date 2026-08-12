/**
 * PAW Cosmetics — Public API
 *
 * @fileoverview The semantic palette and its renderers. cli/tui import
 * `ansiPaint`; gui imports `cssVariables`; everything derives from `PALETTE`.
 *
 * @module @paw/cosmetics
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { PALETTE, ansiOpen, ansiPaint, cssVariables } from './palette.js';
export type { SemanticToken, SemanticTokenId } from './palette.js';
