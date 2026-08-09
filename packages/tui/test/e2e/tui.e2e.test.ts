/**
 * @fileoverview End-to-end tests for the TUI. These spawn `main.ts` as a real
 * process against fixtures, pipe a keystroke sequence on stdin, and assert the
 * final rendered frame — proving the whole path: load config + plan → doctor +
 * herd → reduce over keys → render. This is the E2E tier from CONSTRAINTS.md
 * Constraint 1; it, not a unit test, covers the process shell, the loaders, and
 * the batch input path in `main.ts`. Fails loud is asserted: missing args and a
 * plan-less module both exit non-zero.
 *
 * @module @paw/tui/test/e2e/tui
 */

import { execFile } from 'node:child_process';
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
 * Spawn the TUI with argv and piped keystrokes, resolving with the final frame.
 *
 * @param keys - The keystrokes to pipe.
 * @param args - The argv (config and plan paths by default).
 */
function runTui(
  keys: string,
  args: string[] = [CONFIG, PLAN],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [TSX, MAIN, ...args],
      { cwd: PKG },
      (err, stdout, stderr) => {
        const code = err && typeof err.code === 'number' ? err.code : 0;
        resolve({ stdout, stderr, code });
      },
    );
    child.stdin?.end(keys);
  });
}

describe('tui (e2e)', () => {
  it('opens on the doctor view and reports readiness', async () => {
    const { stdout, code } = await runTui('q');
    expect(code).toBe(0);
    expect(stdout).toContain('▸1 doctor◂');
    expect(stdout).toContain('PAW is ready.');
  });

  it('switches to the plan view and previews the selected member brief', async () => {
    const { stdout } = await runTui('2jq');
    expect(stdout).toContain('▸2 plan◂');
    expect(stdout).toContain('── brief · member 1 ──');
    expect(stdout).toContain('Edit docs/two.mdx.');
  });

  it('switches to the herd view and shows the released herd', async () => {
    const { stdout } = await runTui('3q');
    expect(stdout).toContain('▸3 herd◂');
    expect(stdout).toContain('2 done · 0 skipped');
  });

  it('exits 1 with usage when arguments are missing', async () => {
    const { stderr, code } = await runTui('q', []);
    expect(code).toBe(1);
    expect(stderr).toContain('usage:');
  });

  it('exits 1 when the plan module exports no plan', async () => {
    const { stderr, code } = await runTui('q', [CONFIG, CONFIG]);
    expect(code).toBe(1);
    expect(stderr).toContain('error:');
  });
});
