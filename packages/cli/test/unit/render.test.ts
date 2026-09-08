/**
 * @fileoverview Unit test CLI pure render. Test every branch of
 * `decisionToOutput`; `render.ts` hits 100% coverage.
 *
 * @module @paw/cli/test/unit/render
 */

import { describe, expect, it } from 'vitest';
import { decisionToOutput } from '../../src/domain/render.js';

describe('decisionToOutput', () => {
  it('renders a bare allow as ALLOW with exit 0 on stdout', () => {
    expect(decisionToOutput({ kind: 'allow' })).toEqual({
      text: 'ALLOW',
      exitCode: 0,
      stream: 'stdout',
    });
  });

  it('appends additional context to an allow', () => {
    const out = decisionToOutput({ kind: 'allow', additionalContext: 'fix the test' });
    expect(out.exitCode).toBe(0);
    expect(out.text).toBe('ALLOW\nfix the test');
    expect(out.stream).toBe('stdout');
  });

  it('renders a deny on stderr, where a host reads an exit-2 block reason', () => {
    const out = decisionToOutput({ kind: 'deny', reason: 'blocked: src/a.ts' });
    expect(out.exitCode).toBe(2);
    expect(out.text).toBe('DENY\nblocked: src/a.ts');
    expect(out.stream).toBe('stderr');
  });
});
