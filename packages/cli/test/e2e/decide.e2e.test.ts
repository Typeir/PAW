/**
 * @fileoverview End-to-end test for CLI consumer. Spawn `main.ts` as real
 * process, pipe JSON decision-input on stdin, assert printed output and
 * exit code across whole path: consumer → @paw/core → decision → render →
 * exit. E2E tier from CONSTRAINTS.md Constraint 1, cover process shell in
 * `main.ts`.
 *
 * @module @paw/cli/test/e2e/decide
 */

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX = join(PKG, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MAIN = join(PKG, 'src', 'infrastructure', 'main.ts');

/**
 * Run CLI as child process with given stdin, resolve with its
 * stdout, stderr, exit code.
 *
 * @param stdin - JSON payload to pipe in.
 */
function runCli(stdin: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [TSX, MAIN, 'check'],
      { cwd: PKG },
      (err, stdout, stderr) => {
        const code = err && typeof err.code === 'number' ? err.code : 0;
        resolve({ stdout, stderr, code });
      },
    );
    child.stdin?.end(stdin);
  });
}

describe('cli decide (e2e)', () => {
  it('allows a clean edit end to end, exit 0', async () => {
    const { stdout, code } = await runCli(
      JSON.stringify({ toolName: 'edit', targetPaths: ['src/a.ts'], violations: [] }),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('ALLOW');
  });

  it('denies an unrelated tool when a direct violation stands, exit 2', async () => {
    const { stdout, code } = await runCli(
      JSON.stringify({
        toolName: 'edit',
        targetPaths: ['src/b.ts'],
        violations: [
          { id: 1, filePath: 'src/a.ts', rule: 'jsdoc', message: 'missing', indirectFix: false },
        ],
      }),
    );
    expect(code).toBe(2);
    expect(stdout).toContain('DENY');
    expect(stdout).toContain('src/a.ts');
  });

  it('exits 1 on malformed input rather than pretending to decide', async () => {
    const { code, stderr } = await runCli('not json');
    expect(code).toBe(1);
    expect(stderr).toContain('error:');
  });
});
