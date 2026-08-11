/**
 * Plan Discovery Tests
 *
 * @fileoverview Show what daemon call plan, where it look for config, and
 * refusal keep selection inside repo. Request only ever name plan daemon self
 * discover, so no query string make it import module from elsewhere on disk.
 *
 * @module @paw/daemon/test/plans
 */

import { describe, expect, it } from 'vitest';
import {
  CONFIG_PATH,
  UnknownPlanError,
  discoverPlans,
  findConfig,
  selectPlan,
} from '../src/domain/plans.js';
import type { FileEntry } from '../src/domain/tree.js';

const entries: FileEntry[] = [
  { path: '.paw', isFile: false },
  { path: '.paw/config.json', isFile: true },
  { path: 'plans', isFile: false },
  { path: 'plans/lore.swarm.mjs', isFile: true },
  { path: 'plans/edit.swarm.mjs', isFile: true },
  { path: 'plans/notes.md', isFile: true },
  { path: 'plans/legacy.swarm.mjs.bak', isFile: true },
  { path: 'swarm.mjs', isFile: true },
];

describe('discoverPlans', () => {
  it('finds every *.swarm.mjs, sorted, and nothing else', () => {
    expect(discoverPlans(entries)).toEqual([
      'plans/edit.swarm.mjs',
      'plans/lore.swarm.mjs',
    ]);
  });

  it('finds none in a repository that has none', () => {
    expect(discoverPlans([{ path: 'README.md', isFile: true }])).toEqual([]);
  });

  it('never mistakes a directory for a plan', () => {
    expect(discoverPlans([{ path: 'weird.swarm.mjs', isFile: false }])).toEqual([]);
  });
});

describe('findConfig', () => {
  it('prefers what the operator named', () => {
    expect(findConfig('custom/paw.json', entries)).toBe('custom/paw.json');
  });

  it('falls back to the conventional path when the repo has one', () => {
    expect(findConfig(undefined, entries)).toBe(CONFIG_PATH);
    expect(findConfig('', entries)).toBe(CONFIG_PATH);
  });

  it('reports none rather than inventing one', () => {
    expect(findConfig(undefined, [{ path: 'README.md', isFile: true }])).toBe('');
  });
});

describe('selectPlan', () => {
  const plans = discoverPlans(entries);

  it('selects nothing when nothing was asked for', () => {
    expect(selectPlan(null, plans)).toBeNull();
    expect(selectPlan('', plans)).toBeNull();
  });

  it('accepts a discovered plan, however it was spelled', () => {
    expect(selectPlan('plans/lore.swarm.mjs', plans)).toBe('plans/lore.swarm.mjs');
    expect(selectPlan('plans\\lore.swarm.mjs', plans)).toBe('plans/lore.swarm.mjs');
    expect(selectPlan('./plans/lore.swarm.mjs', plans)).toBe('plans/lore.swarm.mjs');
  });

  it('refuses a path the repository does not hold', () => {
    expect(() => selectPlan('../elsewhere/evil.swarm.mjs', plans)).toThrow(UnknownPlanError);
    expect(() => selectPlan('plans/notes.md', plans)).toThrow(
      'no such plan in this repository: plans/notes.md',
    );
  });
});
