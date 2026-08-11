/**
 * @fileoverview Unit tests for console presenter adapter. Injected sink
 * capture lines; adapter run with no real stdout. Reach 100% coverage.
 *
 * @module @paw/cli/test/unit/presenter
 */

import { describe, expect, it } from 'vitest';
import { makeConsolePresenter } from '../../src/application/presenter.js';

describe('makeConsolePresenter', () => {
  it('prefixes each severity level distinctly', () => {
    const lines: string[] = [];
    const p = makeConsolePresenter((l) => lines.push(l));

    p.info('a');
    p.success('b');
    p.warn('c');
    p.error('d');

    expect(lines).toEqual(['  a', '✓ b', '⚠ c', '✗ d']);
  });

  it('renders a table one row per line, values space-joined', () => {
    const lines: string[] = [];
    const p = makeConsolePresenter((l) => lines.push(l));

    p.table([
      { member: 0, state: 'done' },
      { member: 1, state: 'running' },
    ]);

    expect(lines).toEqual(['0  done', '1  running']);
  });
});
