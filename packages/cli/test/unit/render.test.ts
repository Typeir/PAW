/**
 * @fileoverview Unit test CLI pure render. Test every branch of
 * `decisionToOutput`; `render.ts` hits 100% coverage.
 *
 * @module @paw/cli/test/unit/render
 */

import { describe, expect, it } from 'vitest';
import { decisionToOutput } from '../../src/domain/render.js';

describe('decisionToOutput', () => {
  it('renders a bare allow as ALLOW with exit 0', () => {
    expect(decisionToOutput({ kind: 'allow' })).toEqual({
      text: 'ALLOW',
      exitCode: 0,
    });
  });

  it('appends additional context to an allow', () => {
    const out = decisionToOutput({ kind: 'allow', additionalContext: 'fix the test' });
    expect(out.exitCode).toBe(0);
    expect(out.text).toBe('ALLOW\nfix the test');
  });

  it('renders a deny as DENY plus the reason, with exit 2', () => {
    const out = decisionToOutput({ kind: 'deny', reason: 'blocked: src/a.ts' });
    expect(out.exitCode).toBe(2);
    expect(out.text).toBe('DENY\nblocked: src/a.ts');
  });
});
