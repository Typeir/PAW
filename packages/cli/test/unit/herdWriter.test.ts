/**
 * PAW Herd Writer Tests
 *
 * @fileoverview Pins that a herd's output actually lands on disk at the paths
 * its plan declared, as each member settles rather than at the end — the
 * property that makes a long paid run survive a failure partway through.
 *
 * @module @paw/cli/test/unit/herdWriter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { DispatchEvent, FileSystemPort, SwarmPlan } from '@paw/core';
import { describe, expect, it } from 'vitest';
import { createHerdWriter, declaredOutputs } from '../../src/application/herdWriter.js';

/**
 * A plan whose members write to `out/<n>.md`.
 *
 * @param {boolean} declares - Whether it declares `expectFiles` at all.
 * @returns {SwarmPlan<{ n: number }>} The plan.
 */
function planOf(declares = true): SwarmPlan<{ n: number }> {
  return {
    name: 'herd',
    role: 'edit.apply',
    args: { n: 3 },
    members: (args) => args.n,
    key: (_args, member) => `k${member}`,
    brief: () => 'brief',
    ...(declares ? { expectFiles: (_args: { n: number }, m: number) => `out/${m}.md` } : {}),
  };
}

/**
 * A filesystem fake recording writes and directories.
 *
 * @returns {object} The port and what it recorded.
 */
function fakeFs() {
  const files = new Map<string, string>();
  const dirs: string[] = [];
  const fs: FileSystemPort = {
    readText: async () => '',
    writeText: async (path, content) => {
      files.set(path, content);
    },
    appendText: async () => {},
    ensureDir: async (dir) => {
      dirs.push(dir);
    },
    setExecutable: async () => {},
  };
  return { fs, files, dirs };
}

/**
 * A settled event for a member.
 *
 * @param {number} member - The member.
 * @param {string | undefined} content - What it produced.
 * @returns {DispatchEvent} The event.
 */
const settledEvent = (member: number, content?: string): DispatchEvent => ({
  phase: 'settled',
  member,
  key: `k${member}`,
  total: 3,
  ...(content === undefined
    ? { outcome: { member, key: `k${member}`, state: 'skipped' as const } }
    : { outcome: { member, key: `k${member}`, state: 'done' as const, content } }),
});

describe('createHerdWriter', () => {
  it('writes a member to the path its plan declared', async () => {
    const { fs, files } = fakeFs();
    const writer = createHerdWriter(planOf(), fs);

    await writer.onProgress(settledEvent(1, 'a tale'));

    expect(files.get('out/1.md')).toBe('a tale');
    expect(writer.written()).toEqual(['out/1.md']);
  });

  it('creates the directory before writing into it', async () => {
    const { fs, dirs } = fakeFs();
    await createHerdWriter(planOf(), fs).onProgress(settledEvent(0, 'x'));
    expect(dirs).toContain('out');
  });

  it('writes as each member settles, not at the end', async () => {
    const { fs, files } = fakeFs();
    const writer = createHerdWriter(planOf(), fs);

    await writer.onProgress(settledEvent(0, 'first'));
    expect(files.size).toBe(1);
    await writer.onProgress(settledEvent(2, 'third'));
    expect(files.size).toBe(2);
  });

  it('ignores started events', async () => {
    const { fs, files } = fakeFs();
    await createHerdWriter(planOf(), fs).onProgress({
      phase: 'started',
      member: 0,
      key: 'k0',
      total: 3,
    });
    expect(files.size).toBe(0);
  });

  it('writes nothing for a member that produced no content', async () => {
    const { fs, files } = fakeFs();
    await createHerdWriter(planOf(), fs).onProgress(settledEvent(0));
    expect(files.size).toBe(0);
  });

  it('writes nothing when the plan declares no outputs', async () => {
    const { fs, files } = fakeFs();
    const writer = createHerdWriter(planOf(false), fs);
    await writer.onProgress(settledEvent(0, 'nowhere to go'));
    expect(files.size).toBe(0);
    expect(writer.written()).toEqual([]);
  });

  it('propagates a failing write rather than losing it quietly', async () => {
    const fs: FileSystemPort = {
      readText: async () => '',
      writeText: async () => {
        throw new Error('disk full');
      },
      appendText: async () => {},
      ensureDir: async () => {},
      setExecutable: async () => {},
    };
    await expect(
      createHerdWriter(planOf(), fs).onProgress(settledEvent(0, 'x')),
    ).rejects.toThrow('disk full');
  });

  it('resumes nothing when no existence check is given, so a run repeats rather than silently skipping', async () => {
    const { fs } = fakeFs();
    const writer = createHerdWriter(planOf(), fs);
    await writer.onProgress(settledEvent(0, 'x'));
    expect(writer.alreadyDone('k0')).toBe(false);
  });

  it('reports a member done once its declared output exists', async () => {
    const { fs } = fakeFs();
    const writer = createHerdWriter(planOf(), fs, (p) => p === 'out/0.md');
    await writer.onProgress(settledEvent(0, 'x'));
    await writer.onProgress(settledEvent(1, 'y'));
    expect(writer.alreadyDone('k0')).toBe(true);
    expect(writer.alreadyDone('k1')).toBe(false);
    expect(writer.alreadyDone('never-seen')).toBe(false);
  });
});

describe('declaredOutputs', () => {
  it('maps every resume key to its declared files', () => {
    expect(declaredOutputs(planOf(), 3)).toEqual(
      new Map([
        ['k0', ['out/0.md']],
        ['k1', ['out/1.md']],
        ['k2', ['out/2.md']],
      ]),
    );
  });

  it('maps to empty when the plan declares none', () => {
    expect(declaredOutputs(planOf(false), 2)).toEqual(
      new Map([
        ['k0', []],
        ['k1', []],
      ]),
    );
  });

  it('falls back to the member index when the plan has no key', () => {
    const keyless = { ...planOf(), key: undefined };
    expect([...declaredOutputs(keyless, 2).keys()]).toEqual(['0', '1']);
  });
});
