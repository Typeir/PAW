/**
 * @fileoverview E2E tests for the TUI. Spawn `main.ts` as a process against
 * fixtures, pipe whitespace-separated action ids on stdin (the batch mode),
 * assert the printed sections and the CLI teach line each action ends with.
 * Covers the process shell, loaders, and batch path. Failure exits assert:
 * bare run outside a repository, plan-less module, unknown action id.
 *
 * @module @paw/tui/test/e2e/tui
 */

import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');
const TSX = join(PKG, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MAIN = join(PKG, 'src', 'infrastructure', 'main.ts');
const FIX = join(HERE, '..', 'fixtures');
const CONFIG = join(FIX, 'ready.config.json');
const PLAN = join(FIX, 'demo.swarm.mjs');

/**
 * Spawn the TUI with argv and piped action ids, resolve with output.
 *
 * @param actions - Whitespace-separated action ids to pipe.
 * @param args - argv (config and plan paths by default).
 * @param cwd - Working directory for the process.
 */
function runTui(
  actions: string,
  args: string[] = [CONFIG, PLAN],
  cwd: string = PKG,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [TSX, MAIN, ...args],
      { cwd },
      (err, stdout, stderr) => {
        const code = err && typeof err.code === 'number' ? err.code : 0;
        resolve({ stdout, stderr, code });
      },
    );
    child.stdin?.end(actions);
  });
}

describe('tui (e2e)', () => {
  it('prints the doctor and teaches the CLI verb', async () => {
    const { stdout, code } = await runTui('doctor quit');
    expect(code).toBe(0);
    expect(stdout).toContain('── doctor ──');
    expect(stdout).toContain('PAW is ready.');
    expect(stdout).toContain('cli: paw doctor .paw/config.json');
  });

  it('prints the plan roster with the first member brief', async () => {
    const { stdout, code } = await runTui('plan quit');
    expect(code).toBe(0);
    expect(stdout).toContain('── plan ──');
    expect(stdout).toContain('▸ member 0');
    expect(stdout).toContain('── brief · member 0 ──');
    expect(stdout).toContain('cli: paw swarm show');
  });

  it('prints the dry-run herd result', async () => {
    const { stdout, code } = await runTui('herd quit');
    expect(code).toBe(0);
    expect(stdout).toContain('── herd ──');
    expect(stdout).toContain('2 done · 0 skipped');
    expect(stdout).toContain('cli: paw swarm run');
  });

  it('folds several actions in order', async () => {
    const { stdout, code } = await runTui('doctor herd quit');
    expect(code).toBe(0);
    expect(stdout.indexOf('── doctor ──')).toBeGreaterThanOrEqual(0);
    expect(stdout.indexOf('── herd ──')).toBeGreaterThan(stdout.indexOf('── doctor ──'));
  });

  it('reads config bindings without prompting in batch mode', async () => {
    const { stdout, code } = await runTui('config quit');
    expect(code).toBe(0);
    expect(stdout).toContain('── config ──');
    expect(stdout).toContain('models:');
    expect(stdout).toContain('cli: paw config');
  });

  it('prints the connector catalogue with its enabled state', async () => {
    const { stdout, code } = await runTui('connectors quit');
    expect(code).toBe(0);
    expect(stdout).toContain('── connectors ──');
    expect(stdout).toContain('enabled');
    expect(stdout).toContain('tsc (linter)');
    expect(stdout).toContain('cli: paw connectors');
  });

  it('exits 1 naming the roster on an unknown action id', async () => {
    const { stderr, code } = await runTui('gallop');
    expect(code).toBe(1);
    expect(stderr).toContain('unknown action "gallop"');
    expect(stderr).toContain('doctor plan herd gates daemon config connectors quit');
  });

  it('exits 1 with usage when run bare outside an attached repository', async () => {
    const { stderr, code } = await runTui('quit', []);
    expect(code).toBe(1);
    expect(stderr).toContain('no config at');
    expect(stderr).toContain('usage:');
  });

  it('exits 1 when the plan module exports no plan', async () => {
    const { stderr, code } = await runTui('quit', [CONFIG, CONFIG]);
    expect(code).toBe(1);
    expect(stderr).toContain('error:');
  });

  it('discovers .paw/config.json and the first plan when run bare in a repository', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'paw-tui-e2e-'));
    await mkdir(join(repo, '.paw'), { recursive: true });
    await copyFile(CONFIG, join(repo, '.paw', 'config.json'));
    await copyFile(PLAN, join(repo, 'demo.swarm.mjs'));
    try {
      const { stdout, code } = await runTui('doctor quit', [], repo);
      expect(code).toBe(0);
      expect(stdout).toContain('PAW is ready.');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
