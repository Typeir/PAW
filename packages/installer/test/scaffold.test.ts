/**
 * PAW Installer Scaffold Tests
 *
 * @fileoverview Covers `planInit` — the host-agnostic config and the delegating
 * git hook, with their executable flags — so `scaffold.ts` reaches 100%.
 *
 * @module @paw/installer/test/scaffold
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { planInit } from '../src/scaffold.js';

describe('planInit', () => {
  const plan = planInit('/work/repo');

  it('writes a host-agnostic .paw/config.json (not executable)', () => {
    const config = plan.writes.find((w) => w.path.endsWith('config.json'));
    expect(config?.executable).toBe(false);
    expect(JSON.parse(config?.content ?? '{}')).toMatchObject({
      root: '.paw',
      connector: 'copilot-hooks',
    });
  });

  it('writes a pre-commit hook that delegates to the global paw (executable)', () => {
    const hook = plan.writes.find((w) => w.path.includes('pre-commit'));
    expect(hook?.executable).toBe(true);
    expect(hook?.content).toContain('exec paw check --staged');
  });

  it('vendors no framework code — only config and the hook', () => {
    expect(plan.writes).toHaveLength(2);
    expect(plan.root).toBe('/work/repo');
  });
});
