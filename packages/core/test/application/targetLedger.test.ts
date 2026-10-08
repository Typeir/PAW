/**
 * PAW Target Ledger Tests
 *
 * @fileoverview Snapshot, placeholder creation, and the four proof paths over
 * an in-memory {@link FileSystemPort}: the run that wrote nothing, the run PAW
 * wrote for, the skipped member, and the plan that declares no targets. Covers
 * `targetLedger.ts` to 100%.
 *
 * @module @paw/core/test/application/targetLedger
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { openTargetLedger } from '../../src/application/targetLedger.js';
import type { MemberOutcome } from '../../src/application/dispatchSwarm.js';
import type { SwarmPlan } from '../../src/domain/swarm.js';
import type { FileSystemPort } from '../../src/ports/index.js';

/**
 * In-memory filesystem that records the directories it was asked to make.
 *
 * @param {Record<string, string>} [seed] - Initial file contents by path.
 * @returns {FileSystemPort & { files: Map<string, string>; dirs: string[] }} Port plus its state.
 */
function memFs(
  seed: Record<string, string> = {},
): FileSystemPort & { files: Map<string, string>; dirs: string[] } {
  const files = new Map(Object.entries(seed));
  const dirs: string[] = [];
  return {
    files,
    dirs,
    readText: async (path) => files.get(path) ?? '',
    writeText: async (path, content) => void files.set(path, content),
    appendText: async (path, content) =>
      void files.set(path, (files.get(path) ?? '') + content),
    ensureDir: async (dir) => void dirs.push(dir),
    setExecutable: async () => undefined,
  };
}

const FILES = ['findings/one.md', 'findings/two.md'];

/**
 * Two-member plan whose members each declare one file.
 *
 * @param {Partial<SwarmPlan<unknown>>} [over] - Fields to override.
 * @returns {SwarmPlan<unknown>} The plan.
 */
function plan(over: Partial<SwarmPlan<unknown>> = {}): SwarmPlan<unknown> {
  return {
    name: 'audit',
    role: 'edit.apply',
    args: {},
    members: 2,
    brief: (_a, m) => `member ${m}`,
    expectFiles: (_a, m) => FILES[m] as string,
    ...over,
  };
}

const outcomes = (state: MemberOutcome['state'] = 'done'): MemberOutcome[] => [
  { member: 0, key: 'a', state, content: 'x' },
  { member: 1, key: 'b', state, content: 'x' },
];

describe('openTargetLedger', () => {
  it('creates a placeholder for every absent target, parents first', async () => {
    const fs = memFs();
    const ledger = openTargetLedger(plan(), fs);
    await ledger.snapshot();

    expect(await ledger.createPlaceholders()).toEqual(FILES);
    expect(fs.dirs).toEqual(['findings', 'findings']);
    expect(fs.files.get('findings/one.md')).toBe('');
  });

  it('leaves a target that already has content alone', async () => {
    const fs = memFs({ 'findings/one.md': 'prior' });
    const ledger = openTargetLedger(plan(), fs);
    await ledger.snapshot();

    expect(await ledger.createPlaceholders()).toEqual(['findings/two.md']);
    expect(fs.files.get('findings/one.md')).toBe('prior');
  });

  it('makes no directory for a target at the repository root', async () => {
    const fs = memFs();
    const ledger = openTargetLedger(plan({ expectFiles: () => 'report.md' }), fs);
    await ledger.snapshot();

    expect(await ledger.createPlaceholders()).toEqual(['report.md']);
    expect(fs.dirs).toEqual([]);
  });

  it('unproves every member of a run that left its placeholders empty', async () => {
    const fs = memFs();
    const ledger = openTargetLedger(plan(), fs);
    await ledger.snapshot();
    await ledger.createPlaceholders();

    const proofs = await ledger.prove(outcomes(), []);
    expect(proofs.map((p) => p.state)).toEqual(['unproved', 'unproved']);
    expect(proofs[0]?.targets).toEqual([{ path: 'findings/one.md', state: 'empty' }]);
  });

  it('unproves a member that left an existing file byte-identical', async () => {
    const fs = memFs({ 'findings/one.md': 'prior', 'findings/two.md': 'prior' });
    const ledger = openTargetLedger(plan(), fs);
    await ledger.snapshot();

    const proofs = await ledger.prove(outcomes(), []);
    expect(proofs[0]?.targets).toEqual([{ path: 'findings/one.md', state: 'unchanged' }]);
  });

  it('proves a member whose file gained content', async () => {
    const fs = memFs();
    const ledger = openTargetLedger(plan(), fs);
    await ledger.snapshot();
    await fs.writeText('findings/one.md', 'a real finding');

    const proofs = await ledger.prove(outcomes(), []);
    expect(proofs.map((p) => p.state)).toEqual(['proved', 'unproved']);
  });

  it('proves a path PAW wrote itself even when the content repeats a prior run', async () => {
    const fs = memFs({ 'findings/one.md': 'ran: member 0' });
    const ledger = openTargetLedger(plan(), fs);
    await ledger.snapshot();

    const proofs = await ledger.prove(outcomes(), ['findings/one.md']);
    expect(proofs[0]?.state).toBe('proved');
  });

  it('reads nothing for a skipped member', async () => {
    const fs = memFs();
    const ledger = openTargetLedger(plan(), fs);
    await ledger.snapshot();

    const proofs = await ledger.prove(outcomes('skipped'), []);
    expect(proofs.map((p) => p.state)).toEqual(['skipped', 'skipped']);
  });

  it('calls every member undeclared when the plan declares no expectFiles', async () => {
    const fs = memFs();
    const { expectFiles: _dropped, ...bare } = plan();
    const ledger = openTargetLedger(bare, fs);
    await ledger.snapshot();

    expect(await ledger.createPlaceholders()).toEqual([]);
    const proofs = await ledger.prove(outcomes(), []);
    expect(proofs.map((p) => p.state)).toEqual(['undeclared', 'undeclared']);
  });

  it('treats an unsnapshotted target as absent, so any content proves it', async () => {
    const fs = memFs({ 'findings/one.md': 'written without a snapshot' });
    const proofs = await openTargetLedger(plan(), fs).prove(outcomes(), []);
    expect(proofs[0]?.state).toBe('proved');
  });
});
