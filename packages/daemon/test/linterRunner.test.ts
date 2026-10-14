/**
 * Linter Runner Tests
 *
 * @fileoverview Cover the executing half of the linter connectors against a
 * scripted exec seam: only lintable files reach a linter, enabled state is
 * read per run, eslint findings come back relativised, a linter that cannot
 * run reports nothing, and the whole-project run is detached, single-flight,
 * and scoped to the touched files. The default exec runs real subprocesses to
 * prove it captures stdout on a non-zero exit and rejects when the command
 * cannot start.
 *
 * @module @paw/daemon/test/linterRunner
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LintFinding } from '@paw/core';
import {
  createLinterRunner,
  nodeLintExec,
  toolEntry,
  type LintExec,
} from '../src/infrastructure/linterRunner.js';

const ROOT = '/repo';

/**
 * Exec seam answering per tool, recording every call. The tool is read from
 * the resolved binary path.
 *
 * @param {Record<string, string | (() => Promise<string>)>} answers - Tool name → stdout.
 * @returns {{ exec: LintExec; calls: string[][] }} Seam and its call log.
 */
const scriptedExec = (
  answers: Record<string, string | (() => Promise<string>)>,
): { exec: LintExec; calls: string[][] } => {
  const calls: string[][] = [];
  const exec: LintExec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const entry = args[0] ?? '';
    const tool = Object.keys(answers).find((name) => entry.includes(name));
    const answer = tool === undefined ? undefined : answers[tool];
    if (answer === undefined) {
      throw new Error(`no script for ${entry}`);
    }
    return typeof answer === 'string' ? answer : answer();
  };
  return { exec, calls };
};

const eslintOut = (filePath: string): string =>
  JSON.stringify([
    { filePath, messages: [{ ruleId: 'no-debugger', line: 9, message: 'Unexpected debugger' }] },
  ]);

describe('createLinterRunner', () => {
  it('answers nothing when no touched file is lintable, running no linter', async () => {
    const { exec, calls } = scriptedExec({});
    const runner = createLinterRunner({ root: ROOT, report: () => undefined, enabled: () => ['eslint', 'tsc'], exec });
    expect(await runner.runForFiles(['README.md', 'assets/logo.png'])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('runs no linter when none is enabled, and reads enabled state per run', async () => {
    const { exec, calls } = scriptedExec({ eslint: eslintOut('/repo/src/a.ts') });
    let ids: string[] = [];
    const runner = createLinterRunner({ root: ROOT, report: () => undefined, enabled: () => ids, exec });

    expect(await runner.runForFiles(['src/a.ts'])).toEqual([]);
    expect(calls).toEqual([]);

    ids = ['eslint'];
    expect(await runner.runForFiles(['src/a.ts'])).toHaveLength(1);
    expect(calls[0]).toEqual([
      process.execPath,
      toolEntry(ROOT, 'eslint'),
      '--format',
      'json',
      'src/a.ts',
    ]);
  });

  it('resolves each tool to its own JS entry, never a shell-resolved name', () => {
    expect(toolEntry('/repo', 'eslint')).toBe(
      join('/repo', 'node_modules', 'eslint', 'bin', 'eslint.js'),
    );
    expect(toolEntry('/repo', 'tsc')).toBe(
      join('/repo', 'node_modules', 'typescript', 'bin', 'tsc'),
    );
    expect(toolEntry('/repo', 'unknown-tool')).toBeNull();
  });

  it('relativises eslint findings against the root', async () => {
    const { exec } = scriptedExec({ eslint: eslintOut('C:/repo/src/a.ts') });
    const runner = createLinterRunner({
      root: 'C:/repo',
      report: () => undefined,
      enabled: async () => ['eslint'],
      exec,
    });
    expect(await runner.runForFiles(['src/a.ts'])).toEqual([
      { filePath: 'src/a.ts', line: 9, rule: 'eslint/no-debugger', message: 'Unexpected debugger' },
    ]);
  });

  it('finds nothing when the linter cannot run, and reports why', async () => {
    const exec: LintExec = async () => {
      throw new Error('eslint is not installed');
    };
    const reasons: string[] = [];
    const runner = createLinterRunner({
      root: ROOT,
      report: (reason) => reasons.push(reason),
      enabled: () => ['eslint'],
      exec,
    });
    expect(await runner.runForFiles(['src/a.ts'])).toEqual([]);
    expect(reasons).toEqual(['eslint did not run: Error: eslint is not installed']);
  });

  it('hands whole-project findings to onLate, scoped to the touched files', async () => {
    const tscOut = [
      'src/a.ts(4,1): error TS2304: Cannot find name x.',
      'src/untouched.ts(9,2): error TS2322: Type mismatch.',
    ].join('\n');
    const { exec } = scriptedExec({ tsc: tscOut });
    const late: LintFinding[][] = [];
    const runner = createLinterRunner({
      root: ROOT,
      report: () => undefined,
      enabled: () => ['tsc'],
      exec,
      onLate: (findings) => late.push([...findings]),
    });

    expect(await runner.runForFiles(['src/a.ts'])).toEqual([]);
    await vi.waitFor(() => expect(late).toHaveLength(1));
    expect(late[0]).toEqual([
      { filePath: 'src/a.ts', line: 4, rule: 'tsc/TS2304', message: 'Cannot find name x.' },
    ]);
  });

  it('says nothing late when the project run finds nothing in the touched files', async () => {
    const { exec, calls } = scriptedExec({ tsc: 'src/elsewhere.ts(1,1): error TS1005: x' });
    const late: LintFinding[][] = [];
    const runner = createLinterRunner({
      root: ROOT,
      report: () => undefined,
      enabled: () => ['tsc'],
      exec,
      onLate: (findings) => late.push([...findings]),
    });
    await runner.runForFiles(['src/a.ts']);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(late).toEqual([]);
  });

  it('keeps the project run single-flight, survives its failure, and reports it', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const { exec, calls } = scriptedExec({
      tsc: async () => {
        await gate;
        throw new Error('tsc exploded');
      },
    });
    const reasons: string[] = [];
    const runner = createLinterRunner({
      root: ROOT,
      report: (reason) => reasons.push(reason),
      enabled: () => ['tsc'],
      exec,
      onLate: () => undefined,
    });

    await runner.runForFiles(['src/a.ts']);
    await runner.runForFiles(['src/b.ts']);
    expect(calls).toHaveLength(1);

    release!();
    await vi.waitFor(async () => {
      await runner.runForFiles(['src/c.ts']);
      expect(calls).toHaveLength(2);
    });
    expect(reasons).toContain('tsc did not run: Error: tsc exploded');
  });

  it('runs the real tool entry by default, and reports a tool that is not installed', async () => {
    const reasons: string[] = [];
    const runner = createLinterRunner({
      root: mkdtempSync(join(tmpdir(), 'paw-lint-none-')),
      report: (reason) => reasons.push(reason),
      enabled: () => ['eslint'],
    });
    expect(await runner.runForFiles(['src/a.ts'])).toEqual([]);
    expect(reasons).toEqual([expect.stringMatching(/^eslint did not run: /)]);
  });

  it('starts no project run without a late sink', async () => {
    const { exec, calls } = scriptedExec({ tsc: '' });
    const runner = createLinterRunner({ root: ROOT, report: () => undefined, enabled: () => ['tsc'], exec });
    await runner.runForFiles(['src/a.ts']);
    expect(calls).toEqual([]);
  });
});

describe('nodeLintExec', () => {
  it('captures stdout from a command that exits non-zero', async () => {
    const out = await nodeLintExec(
      process.execPath,
      ['-e', 'console.log("findings");process.exit(1)'],
      process.cwd(),
      10_000,
    );
    expect(out).toContain('findings');
  });

  it('rejects when the command cannot run at all', async () => {
    await expect(
      nodeLintExec(process.execPath, ['-e', 'process.exit(3)'], process.cwd(), 10_000),
    ).rejects.toThrow();
  });
});
