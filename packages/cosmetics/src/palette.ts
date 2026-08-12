/**
 * PAW Semantic Palette
 *
 * @fileoverview The one palette every PAW surface renders. Each token names a
 * meaning — command verb, flag, parameter, optional, PAW concept, hook event,
 * cross-domain tech term — with its xterm-256 index, its hex twin for CSS, and
 * its emphasis. Muted tones, readable on dark and light grounds. cli and tui
 * paint with {@link ansiPaint}; gui takes {@link cssVariables}. Change a hue
 * here and every surface follows.
 *
 * @module @paw/cosmetics/palette
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * One semantic token.
 *
 * @interface SemanticToken
 * @property {number | null} xterm - xterm-256 color index; null inherits the terminal foreground.
 * @property {string | null} hex - Hex twin for CSS surfaces; null inherits.
 * @property {boolean} bold - Bold emphasis.
 * @property {boolean} italic - Italic emphasis.
 */
export interface SemanticToken {
  readonly xterm: number | null;
  readonly hex: string | null;
  readonly bold: boolean;
  readonly italic: boolean;
}

/**
 * Token ids the palette defines.
 */
export type SemanticTokenId =
  | 'verb'
  | 'flag'
  | 'param'
  | 'optional'
  | 'concept'
  | 'event'
  | 'tech';

/**
 * The palette: verb bold; flag grey; param sage italic; optional amber italic;
 * concept soft cyan; event the same cyan bold; tech muted magenta.
 */
export const PALETTE: Readonly<Record<SemanticTokenId, SemanticToken>> = {
  verb: { xterm: null, hex: null, bold: true, italic: false },
  flag: { xterm: 245, hex: '#8a8a8a', bold: false, italic: false },
  param: { xterm: 108, hex: '#87af87', bold: false, italic: true },
  optional: { xterm: 179, hex: '#d7af5f', bold: false, italic: true },
  concept: { xterm: 73, hex: '#5fafaf', bold: false, italic: false },
  event: { xterm: 73, hex: '#5fafaf', bold: true, italic: false },
  tech: { xterm: 175, hex: '#d787af', bold: false, italic: false },
};

const ANSI_RESET = '\x1b[0m';

/**
 * The ANSI escape opening one token's style.
 *
 * @param {SemanticToken} token - The token.
 * @returns {string} Escape sequence; empty for a token with no styling.
 */
export function ansiOpen(token: SemanticToken): string {
  const parts: string[] = [];
  if (token.bold) {
    parts.push('1');
  }
  if (token.italic) {
    parts.push('3');
  }
  if (token.xterm !== null) {
    parts.push(`38;5;${token.xterm}`);
  }
  return parts.length === 0 ? '' : `\x1b[${parts.join(';')}m`;
}

/**
 * A painter per token id: wrap text in the token's ANSI style and a reset.
 * What cli help and the tui render with.
 */
export const ansiPaint: Readonly<Record<SemanticTokenId, (text: string) => string>> =
  Object.fromEntries(
    (Object.entries(PALETTE) as Array<[SemanticTokenId, SemanticToken]>).map(([id, token]) => [
      id,
      (text: string) => `${ansiOpen(token)}${text}${ANSI_RESET}`,
    ]),
  ) as Record<SemanticTokenId, (text: string) => string>;

/**
 * The palette as CSS custom properties, one `--sem-<id>` per colored token,
 * for a stylesheet's `:root` block. Tokens with no hue are omitted — emphasis
 * is the stylesheet's call there.
 *
 * @returns {string} Declaration lines, `;`-terminated, newline-joined.
 */
export function cssVariables(): string {
  return (Object.entries(PALETTE) as Array<[SemanticTokenId, SemanticToken]>)
    .filter(([, token]) => token.hex !== null)
    .map(([id, token]) => `--sem-${id}: ${token.hex};`)
    .join('\n');
}
