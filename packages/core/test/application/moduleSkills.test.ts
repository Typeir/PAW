/**
 * Module Skills Tests
 *
 * @fileoverview Cover placing a module's skills into a repository: free and
 * own folders are placed, a folder PAW did not place is skipped with the
 * reason, removal takes only the module's own, and the exclude file gains and
 * loses exactly the placed paths.
 *
 * @module @paw/core/test/application/moduleSkills
 */

import { describe, expect, it } from 'vitest';
import {
  SKILLS_DIR,
  excludeWith,
  excludeWithout,
  planSkillPlacement,
  skillsOwnedBy,
} from '../../src/application/moduleSkills.js';

describe('planSkillPlacement', () => {
  it('places a skill whose folder is free or already this module', () => {
    const plan = planSkillPlacement('paw-agile', ['paw-tasks', 'paw-graph'], new Map([['paw-graph', 'paw-agile']]));
    expect(plan.place).toEqual([
      { name: 'paw-tasks', from: '.paw/modules/paw-agile/skills/paw-tasks', to: `${SKILLS_DIR}/paw-tasks` },
      { name: 'paw-graph', from: '.paw/modules/paw-agile/skills/paw-graph', to: `${SKILLS_DIR}/paw-graph` },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a folder PAW did not place, or another module placed, naming why', () => {
    const plan = planSkillPlacement(
      'paw-agile',
      ['paw-tasks', 'review'],
      new Map<string, string | null>([
        ['paw-tasks', null],
        ['review', 'paw-rally'],
      ]),
    );
    expect(plan.place).toEqual([]);
    expect(plan.skipped).toEqual([
      { name: 'paw-tasks', reason: `${SKILLS_DIR}/paw-tasks already exists and PAW did not place it; remove it to let paw-agile place its skill` },
      { name: 'review', reason: `${SKILLS_DIR}/review belongs to module paw-rally` },
    ]);
  });
});

describe('skillsOwnedBy', () => {
  it('lists the placed skills one module owns', () => {
    const owners = new Map<string, string | null>([
      ['paw-tasks', 'paw-agile'],
      ['review', 'paw-rally'],
      ['mine', null],
    ]);
    expect(skillsOwnedBy('paw-agile', owners)).toEqual([`${SKILLS_DIR}/paw-tasks`]);
  });
});

describe('excludeWith / excludeWithout', () => {
  it('appends each placed path once, keeping what was there', () => {
    const text = excludeWith('# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n', ['.claude/skills/paw-tasks']);
    expect(text).toBe('# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n/.claude/skills/paw-tasks/\n');
    expect(excludeWith(text, ['.claude/skills/paw-tasks'])).toBe(text);
  });

  it('adds a newline before appending to a file that lacks one, and starts an empty file clean', () => {
    expect(excludeWith('*.log', ['.claude/skills/a'])).toBe('*.log\n/.claude/skills/a/\n');
    expect(excludeWith('', ['.claude/skills/a'])).toBe('/.claude/skills/a/\n');
  });

  it('removes exactly the given paths', () => {
    const text = '*.log\n/.claude/skills/paw-tasks/\n/.claude/skills/other/\n';
    expect(excludeWithout(text, ['.claude/skills/paw-tasks'])).toBe('*.log\n/.claude/skills/other/\n');
  });
});
