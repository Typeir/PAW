/**
 * Highlighter Tests
 *
 * @fileoverview Shows every token class the plan view can render, plus every
 * way incomplete source breaks it — unterminated string, unclosed template.
 * Console renders the file bytes as stored on disk.
 *
 * @module @paw/gui/test/unit/presentation/highlight
 */

import { describe, expect, it } from 'vitest';
import { highlightJs } from '../../../src/presentation/lib/highlight.js';

describe('highlightJs', () => {
  it('classes keywords, calls, and plain identifiers', () => {
    const html = highlightJs('const total = members (args);');
    expect(html).toContain('<span class="k">const</span>');
    expect(html).toContain('<span class="f">members</span>');
    expect(html).toContain('total');
  });

  it('classes single- and double-quoted strings with escapes', () => {
    const html = highlightJs(`const a = 'it\\'s'; const b = "x";`);
    expect(html).toContain(`<span class="s">&#39;it\\&#39;s&#39;</span>`);
    expect(html).toContain('<span class="s">&quot;x&quot;</span>');
  });

  it('closes an unterminated string at the line end and at the file end', () => {
    expect(highlightJs("const a = 'oops\nconst b = 1;")).toContain('<span class="s">&#39;oops</span>');
    expect(highlightJs("const a = 'oops")).toContain('<span class="s">&#39;oops</span>');
  });

  it('classes line comments to the newline and to the end of file', () => {
    expect(highlightJs('// note\nconst a = 1;')).toContain('<span class="c">// note</span>');
    expect(highlightJs('// trailing')).toContain('<span class="c">// trailing</span>');
  });

  it('accents template interpolations, including nested braces and strings', () => {
    const html = highlightJs('const t = `a ${ obj[`${k}`] } b ${ {x: "}"} } c`;');
    expect(html).toContain('<span class="i">');
    expect(html).toContain('<span class="s">');
  });

  it('walks an escape inside a string inside an interpolation', () => {
    const html = highlightJs('const t = `${ f("a\\"b") }`;');
    expect(html).toContain('<span class="i">');
  });

  it('keeps an escape inside a template out of the interpolation scan', () => {
    expect(highlightJs('const t = `a \\${ b } c`;')).toContain('<span class="s">');
  });

  it('closes an unterminated template at the end of file', () => {
    expect(highlightJs('const t = `open')).toContain('<span class="s">`open</span>');
  });

  it('escapes every character it did not tokenize', () => {
    expect(highlightJs('a < b && c > d')).toContain('&lt;');
    expect(highlightJs('a < b && c > d')).toContain('&gt;');
    expect(highlightJs('a & b')).toContain('&amp;');
  });

  it('reopens a span at each line boundary so every row stands alone', () => {
    const html = highlightJs('const t = `one\ntwo`;');
    expect(html.split('<span class="row"').length - 1).toBeGreaterThanOrEqual(1);
    expect(html).toContain('two');
  });

  it('accents the requested line and no line when none is asked for', () => {
    expect(highlightJs('a\nb', 2)).toContain('<span class="row hl">');
    expect(highlightJs('a\nb')).not.toContain('hl');
  });
});
