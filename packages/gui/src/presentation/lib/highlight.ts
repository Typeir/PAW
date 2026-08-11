/**
 * PAW GUI syntax highlighter.
 *
 * @fileoverview Tiny tokenizer, no dep. Converts swarm plan source to console
 * code view. Page runs under strict CSP and cannot pull a highlighter library,
 * so the scanner is hand-rolled. Covers only what the plan uses: keywords,
 * strings, line comments, template literals, and `${…}` interpolations in accent
 * colour, where per-member data enters the brief. Emits `.code` row markup with
 * line number and colour; escapes every char not tokenized.
 *
 * @module @paw/gui/presentation/lib/highlight
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'from', 'export',
  'default', 'new', 'await', 'async', 'if', 'else', 'for', 'of', 'in',
  'true', 'false', 'null', 'undefined',
]);

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape string for safe HTML text.
 *
 * @param {string} text - Raw string.
 * @returns {string} Escaped string.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESC[ch]);
}

/**
 * Classified run of source text.
 *
 * @interface Token
 * @property {string} cls - Token class (`k`/`s`/`c`/`f`/`i`), or empty for plain text.
 * @property {string} text - Raw source, possibly span newlines (templates).
 */
interface Token {
  readonly cls: string;
  readonly text: string;
}

const IDENT = /[A-Za-z0-9_$]/;
const IDENT_START = /[A-Za-z_$]/;

/**
 * Scan JavaScript source into flat list of classified tokens.
 *
 * @param {string} src - Source.
 * @returns {Token[]} Tokens in source order.
 */
function scan(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (cls: string, text: string): void => {
    if (text.length > 0) {
      tokens.push({ cls, text });
    }
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '/' && src[i + 1] === '/') {
      let j = i + 2;
      while (j < src.length && src[j] !== '\n') {
        j += 1;
      }
      push('c', src.slice(i, j));
      i = j;
      continue;
    }

    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') {
        j += src[j] === '\\' ? 2 : 1;
      }
      const closed = src[j] === ch;
      const end = closed ? j + 1 : j;
      push('s', src.slice(i, end));
      i = end;
      continue;
    }

    if (ch === '`') {
      i = scanTemplate(src, i, push);
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && IDENT.test(src[j])) {
        j += 1;
      }
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && src[k] === ' ') {
        k += 1;
      }
      if (KEYWORDS.has(word)) {
        push('k', word);
      } else if (src[k] === '(') {
        push('f', word);
      } else {
        push('', word);
      }
      i = j;
      continue;
    }

    push('', ch);
    i += 1;
  }
  return tokens;
}

/**
 * Scan template literal from backtick. Emit string parts as `s`, each `${…}`
 * interpolation as `i`.
 *
 * @param {string} src - Source.
 * @param {number} start - Index of opening backtick.
 * @param {(cls: string, text: string) => void} push - Token sink.
 * @returns {number} Index just past closing backtick.
 */
function scanTemplate(
  src: string,
  start: number,
  push: (cls: string, text: string) => void,
): number {
  let j = start + 1;
  let literalFrom = start;
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src[j] === '$' && src[j + 1] === '{') {
      push('s', src.slice(literalFrom, j));
      let depth = 1;
      let k = j + 2;
      while (k < src.length && depth > 0) {
        const c = src[k];
        if (c === '"' || c === "'" || c === '`') {
          k += 1;
          while (k < src.length && src[k] !== c) {
            k += src[k] === '\\' ? 2 : 1;
          }
          k += 1;
          continue;
        }
        if (c === '{') {
          depth += 1;
        } else if (c === '}') {
          depth -= 1;
        }
        k += 1;
      }
      push('i', src.slice(j, k));
      j = k;
      literalFrom = k;
      continue;
    }
    j += 1;
  }
  const end = Math.min(j + 1, src.length);
  push('s', src.slice(literalFrom, end));
  return end;
}

/**
 * Highlight swarm plan source into `.code` row markup — one `.row` per line,
 * with optional line highlighted. Token span newlines (template) close and
 * reopen span at each line boundary, so every row valid on own.
 *
 * @param {string} source - Plan source.
 * @param {number} [highlightLine] - 1-based line to mark with accent wash.
 * @returns {string} `.code` inner HTML.
 */
export function highlightJs(source: string, highlightLine?: number): string {
  const rows: string[] = [''];
  for (const token of scan(source)) {
    const open = token.cls ? `<span class="${token.cls}">` : '';
    const close = token.cls ? '</span>' : '';
    const parts = token.text.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) {
        rows.push('');
      }
      rows[rows.length - 1] += open + escapeHtml(part) + close;
    });
  }
  return rows
    .map((html, idx) => {
      const cls = idx + 1 === highlightLine ? 'row hl' : 'row';
      return `<span class="${cls}">${html}</span>`;
    })
    .join('');
}
