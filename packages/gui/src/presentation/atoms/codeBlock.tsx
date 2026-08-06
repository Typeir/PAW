/**
 * Code Block Atom
 *
 * @fileoverview The plan-source view: a `pre`, because it is preformatted source
 * and nothing else models that. It scrolls horizontally, so it is a labelled,
 * focusable region — a scroll container a keyboard cannot reach is a trap. The
 * highlighter emits the row markup the stylesheet numbers and colours, so this
 * sets it as HTML; every character it did not tokenize was escaped on the way
 * out, which is what makes that safe.
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
 * @property {string} source - The JavaScript source to show.
 * @property {number} [highlightLine] - 1-based line to accent.
 * @property {string} label - The accessible name for the region.
 */
export interface CodeBlockProps {
  readonly source: string;
  readonly highlightLine?: number;
  readonly label: string;
}

/**
 * A syntax-highlighted, line-numbered source view.
 *
 * @param {CodeBlockProps} props - The block props.
 * @returns {JSX.Element} The code view.
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
