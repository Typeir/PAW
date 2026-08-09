/**
 * @fileoverview End-to-end tests for the CLI consumer. These spawn `main.ts` as
 * a real process, pipe a JSON decision-input on stdin, and assert the printed
 * output and exit code — proving the whole path works: consumer → @paw/core →
 * decision → render → exit. This is the E2E tier from CONSTRAINTS.md Constraint 1;
 * it, not a unit test, is what covers the process shell in `main.ts`.
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
 * Run the CLI as a child process with the given stdin, resolving with its
 * stdout, stderr, and exit code.
 *
 * @param stdin - The JSON payload to pipe in.
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
