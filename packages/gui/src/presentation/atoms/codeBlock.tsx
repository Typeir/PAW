/**
 * Code Block Atom
 *
 * @fileoverview Plan-source view. Renders a `pre` element holding preformatted
 * source. Horizontal scrolling requires a labelled, focusable region; without
 * focus a scroll box is unreachable by keyboard. The highlighter emits row
 * markup and stylesheet numbers and colors as HTML. Characters not tokenized
 * are escaped, so the output is safe.
 *
 * @module @paw/gui/presentation/atoms/codeBlock
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { highlightJs } from '../lib/highlight.js';

/**
 * Props for {@link CodeBlock}.
 *
 * @interface CodeBlockProps
 * @property {string} source - JavaScript source to show.
 * @property {number} [highlightLine] - 1-based line to accent.
 * @property {string} label - Accessible name for region.
 */
export interface CodeBlockProps {
  readonly source: string;
  readonly highlightLine?: number;
  readonly label: string;
}

/**
 * Syntax-highlighted, line-numbered source view.
 *
 * @param {CodeBlockProps} props - Block props.
 * @returns {JSX.Element} Code view.
 */
export function CodeBlock({ source, highlightLine, label }: CodeBlockProps) {
  return (
    <pre
      role='region'
      aria-label={label}
      tabIndex={0}
      dangerouslySetInnerHTML={{ __html: highlightJs(source, highlightLine) }}
    />
  );
}
