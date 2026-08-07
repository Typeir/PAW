/**
 * PAW Console Page Resolution Tests
 *
 * @fileoverview Pins the two layouts PAW actually ships in. The console is one
 * self-contained page that sits beside the bundle in a built artifact and under
 * `packages/gui/dist` in a source checkout, and the resolver has to be right in
 * both without anything being passed on the command line.
 *
 * @module @paw/daemon/test/consolePage
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { CONSOLE_PAGE_FILE, consolePage, resolveConsolePage } from '../src/consolePage.js';

/**
 * Normalise a path for comparison regardless of platform separator.
 *
 * @param {string} p - The path.
 * @returns {string} The path with forward slashes.
 */
function fwd(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('resolveConsolePage', () => {
  it('prefers the copy beside the artifact', () => {
    const artifact = '/opt/paw/versions/5.0.0';
    const found = resolveConsolePage(artifact, (p) =>
      fwd(p) === `${artifact}/gui/${CONSOLE_PAGE_FILE}`,
    );
    expect(fwd(found)).toBe(`${artifact}/gui/${CONSOLE_PAGE_FILE}`);
  });

  it('falls back to the source checkout layout', () => {
    const src = '/repo/packages/daemon/src';
    const found = resolveConsolePage(src, (p) =>
      fwd(p) === `/repo/packages/gui/dist/${CONSOLE_PAGE_FILE}`,
    );
    expect(fwd(found)).toBe(`/repo/packages/gui/dist/${CONSOLE_PAGE_FILE}`);
  });

  it('takes the artifact copy when both exist', () => {
    const src = '/repo/packages/daemon/src';
    const found = resolveConsolePage(src, () => true);
    expect(fwd(found)).toBe(`${src}/gui/${CONSOLE_PAGE_FILE}`);
  });

  it('returns the artifact location when the page is nowhere, so the miss names where it belongs', () => {
    const artifact = '/opt/paw/versions/5.0.0';
    const found = resolveConsolePage(artifact, () => false);
    expect(fwd(found)).toBe(`${artifact}/gui/${CONSOLE_PAGE_FILE}`);
  });
});

describe('consolePage', () => {
  it('resolves against this module without being told where it is', () => {
    expect(fwd(consolePage())).toContain(CONSOLE_PAGE_FILE);
  });

  it('finds the real built console in this checkout', () => {
    expect(fwd(consolePage())).toContain(`packages/gui/dist/${CONSOLE_PAGE_FILE}`);
  });
});
