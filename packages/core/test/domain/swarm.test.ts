/**
 * PAW Swarm Domain Tests
 *
 * @fileoverview Covers member-count resolution, brief rendering, resume keys,
 * target resolution, and every branch of the plan doctor — including a plan
 * that fails each check — so `swarm.ts` reaches 100%.
 *
 * @module @paw/core/test/domain/swarm
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  contextOf,
  doctorPlan,
  memberCount,
  planKey,
  renderBrief,
  targetsOf,
  type SwarmPlan,
} from '../../src/domain/swarm.js';

interface Row {
  file: string;
  change: string;
}

/**
 * A healthy plan over three rows; overrides let each test bend one axis.
 *
 * @param {Partial<SwarmPlan<{ rows: Row[] }>>} over - Fields to override.
 * @returns {SwarmPlan<{ rows: Row[] }>} A plan.
 */
const plan = (
  over: Partial<SwarmPlan<{ rows: Row[] }>> = {},
): SwarmPlan<{ rows: Row[] }> => ({
  name: 'spell-refactor',
  role: 'edit.apply',
  args: {
    rows: [
      { file: 'a.mdx', change: 'x' },
      { file: 'b.mdx', change: 'y' },
      { file: 'c.mdx', change: 'z' },
    ],
  },
  members: (a) => a.rows.length,
  brief: (a, m, n) => `member ${m + 1}/${n}: edit ${a.rows[m].file}`,
  expectFiles: (a, m) => a.rows[m].file,
  key: (a, m) => a.rows[m].file,
  ...over,
});

describe('memberCount', () => {
  it('resolves a function form', () => {
    expect(memberCount(plan())).toBe(3);
  });

  it('resolves a literal number form', () => {
    expect(memberCount(plan({ members: 5 }))).toBe(5);
  });
});

describe('renderBrief / planKey / targetsOf', () => {
  it('renders a member brief with the resolved count', () => {
    expect(renderBrief(plan(), 0)).toBe('member 1/3: edit a.mdx');
  });

  it('keys by the plan key when present, else the index', () => {
    expect(planKey(plan(), 1)).toBe('b.mdx');
    expect(planKey(plan({ key: undefined }), 1)).toBe('1');
  });

  it('normalises targets to an array, and is empty without expectFiles', () => {
    expect(targetsOf(plan(), 2)).toEqual(['c.mdx']);
    expect(targetsOf(plan({ expectFiles: (a, m) => [a.rows[m].file, 'extra'] }), 0)).toEqual([
      'a.mdx',
      'extra',
    ]);
    expect(targetsOf(plan({ expectFiles: undefined }), 0)).toEqual([]);
  });
});

describe('contextOf', () => {
  it('is empty when the plan attaches no context', () => {
    expect(contextOf(plan(), 0)).toEqual([]);
  });

  it('returns the paths the plan declares for that member', () => {
    const withContext = plan({ contextFiles: (a, m) => ['shared.md', a.rows[m].file] });
    expect(contextOf(withContext, 1)).toEqual(['shared.md', 'b.mdx']);
  });
});

describe('doctorPlan', () => {
  it('passes a healthy plan on every check', () => {
    const findings = doctorPlan(plan());
    expect(findings.every((f) => f.ok)).toBe(true);
    expect(findings.map((f) => f.check)).toEqual([
      'count',
      'total-brief',
      'purity',
      'file-conflict',
      'key-collision',
      'context-paths',
    ]);
  });

  it('short-circuits on a non-positive member count', () => {
    const findings = doctorPlan(plan({ members: 0 }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ check: 'count', ok: false });
  });

  it('fails total-brief when a member renders empty', () => {
    const findings = doctorPlan(plan({ brief: (_a, m) => (m === 2 ? '' : 'ok') }));
    const brief = findings.find((f) => f.check === 'total-brief');
    expect(brief).toMatchObject({ ok: false });
    expect(brief?.detail).toContain('member 2');
  });

  it('fails total-brief without crashing when a member throws (the off-by-one)', () => {
    const findings = doctorPlan(plan({ members: 4, brief: (a, m) => a.rows[m].file }));
    const brief = findings.find((f) => f.check === 'total-brief');
    expect(brief).toMatchObject({ ok: false });
    expect(brief?.detail).toContain('member 3');
    expect(findings.some((f) => f.check === 'purity')).toBe(false);
  });

  it('reports a non-Error thrown value as a total-brief failure', () => {
    const findings = doctorPlan(
      plan({
        members: 1,
        brief: () => {
          throw 'boom';
        },
      }),
    );
    expect(findings.find((f) => f.check === 'total-brief')).toMatchObject({
      ok: false,
      detail: 'member 0 threw: boom',
    });
  });

  it('fails purity when a brief is non-deterministic', () => {
    let n = 0;
    const findings = doctorPlan(plan({ brief: () => `call-${(n += 1)}` }));
    expect(findings.find((f) => f.check === 'purity')).toMatchObject({ ok: false });
  });

  it('fails file-conflict when two members target the same file', () => {
    const findings = doctorPlan(plan({ expectFiles: () => 'same.mdx' }));
    const conflict = findings.find((f) => f.check === 'file-conflict');
    expect(conflict).toMatchObject({ ok: false });
    expect(conflict?.detail).toContain('same.mdx');
  });

  it('skips file-conflict cleanly when no expectFiles is declared', () => {
    const findings = doctorPlan(plan({ expectFiles: undefined }));
    expect(findings.find((f) => f.check === 'file-conflict')).toMatchObject({
      ok: true,
      detail: 'no expectFiles declared',
    });
  });

  it('skips context-paths cleanly when no contextFiles is declared', () => {
    expect(doctorPlan(plan()).find((f) => f.check === 'context-paths')).toMatchObject({
      ok: true,
      detail: 'no contextFiles declared',
    });
  });

  it('passes context-paths when every declared path is a real path', () => {
    const findings = doctorPlan(plan({ contextFiles: () => ['docs/a.md', 'docs/b.md'] }));
    expect(findings.find((f) => f.check === 'context-paths')).toMatchObject({ ok: true });
  });

  it('fails context-paths on an empty path, before a single token is spent', () => {
    const findings = doctorPlan(plan({ contextFiles: (_a, m) => (m === 1 ? [''] : ['ok.md']) }));
    const context = findings.find((f) => f.check === 'context-paths');
    expect(context).toMatchObject({ ok: false });
    expect(context?.detail).toContain('member 1');
  });

  it('fails context-paths when a plan yields something that is not a path', () => {
    const findings = doctorPlan(
      plan({ contextFiles: () => [undefined as unknown as string] }),
    );
    expect(findings.find((f) => f.check === 'context-paths')).toMatchObject({ ok: false });
  });
});

describe('doctorPlan key-collision', () => {
  /**
   * A plan whose members derive their key from a name, so a repeated name
   * collides exactly as a repeated filename does in a real plan.
   *
   * @param {readonly string[]} names - One name per member.
   * @returns {SwarmPlan<{ names: readonly string[] }>} The plan.
   */
  const keyedBy = (names: readonly string[]): SwarmPlan<{ names: readonly string[] }> => ({
    name: 'keyed',
    role: 'edit.apply',
    args: { names },
    members: (a) => a.names.length,
    brief: (_a, m) => `brief-${m}`,
    key: (a, m) => `tale:${a.names[m]}`,
  });

  it('passes when every member has its own key', () => {
    const finding = doctorPlan(keyedBy(['alpha', 'beta', 'gamma'])).find(
      (f) => f.check === 'key-collision',
    );
    expect(finding).toEqual({ check: 'key-collision', ok: true });
  });

  it('refuses two members that share a key, naming both', () => {
    // The real shape of this bug: two source files called `main.mdx` in
    // different directories, reduced to the same key by a basename-derived
    // naming rule.
    const findings = doctorPlan(keyedBy(['bard/main', 'druid/main'].map((p) => p.split('/')[1])));
    const finding = findings.find((f) => f.check === 'key-collision');

    expect(finding?.ok).toBe(false);
    expect(finding?.detail).toContain('members 0 and 1');
    expect(finding?.detail).toContain('tale:main');
  });

  it('names the first colliding pair when several collide', () => {
    const finding = doctorPlan(keyedBy(['a', 'b', 'b', 'c', 'c'])).find(
      (f) => f.check === 'key-collision',
    );
    expect(finding?.detail).toContain('members 1 and 2');
  });

  it('refuses the release, because a collision silently skips real work', () => {
    // Every later member sharing a key is reported `skipped`, which reads
    // exactly like a legitimate resume — so the release must not proceed.
    expect(doctorPlan(keyedBy(['same', 'same'])).every((f) => f.ok)).toBe(false);
  });
});
