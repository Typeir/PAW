/**
 * PAW Node Process Adapter Tests
 *
 * @fileoverview Drive process adapter against real short-lived Node processes.
 * Check stdout, stderr, non-zero exit, passed env, timeout, spawn that cannot
 * launch, detached spawn. Cover every branch, including rejections on failure.
 *
 * @module @paw/adapters/test/process/nodeProcess
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { createNodeProcess } from '../../src/process/nodeProcess.js';

const proc = createNodeProcess();
const NODE = process.execPath;
const MISSING = 'paw-no-such-command-xyz';

describe('createNodeProcess.run', () => {
  it('captures stdout and a zero exit', async () => {
    const r = await proc.run(NODE, ['-e', "process.stdout.write('hi')"]);
    expect(r).toEqual({ stdout: 'hi', stderr: '', code: 0 });
  });

  it('captures stderr and a non-zero exit as a result, not a failure', async () => {
    const r = await proc.run(NODE, [
      '-e',
      "process.stderr.write('boom'); process.exit(4)",
    ]);
    expect(r.stderr).toBe('boom');
    expect(r.code).toBe(4);
  });

  it('passes the provided environment', async () => {
    const r = await proc.run(NODE, ['-e', 'process.stdout.write(process.env.PAW_X)'], {
      env: { ...process.env, PAW_X: 'yes' },
    });
    expect(r.stdout).toBe('yes');
  });

  it('rejects loudly when the timeout elapses', async () => {
    await expect(
      proc.run(NODE, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 150 }),
    ).rejects.toThrow(/timed out/);
  });

  it('rejects loudly when the command cannot be spawned', async () => {
    await expect(proc.run(MISSING, [])).rejects.toBeInstanceOf(Error);
  });
});

describe('createNodeProcess.spawnDetached', () => {
  it('returns the pid of a detached child', async () => {
    const pid = await proc.spawnDetached(NODE, ['-e', '0']);
    expect(typeof pid).toBe('number');
    expect(pid).toBeGreaterThan(0);
  });

  it('rejects loudly when a detached spawn cannot launch', async () => {
    await expect(proc.spawnDetached(MISSING, [])).rejects.toBeInstanceOf(Error);
  });
});
