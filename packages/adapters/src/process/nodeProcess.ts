/**
 * PAW Node Process Adapter
 *
 * @fileoverview Build {@link ProcessPort} on `node:child_process`, cross-platform.
 * Fail loud per CONSTRAINTS.md Constraint 3. Spawn no launch — reject. Non-zero
 * exit resolve result; process ran.
 *
 * @module @paw/adapters/process/nodeProcess
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { spawn } from 'node:child_process';
import type {
  ProcessPort,
  ProcessResult,
  ProcessRunOptions,
} from '@paw/core';

/**
 * Make Node process adapter.
 *
 * @returns {ProcessPort} Process port backed by `node:child_process`.
 */
export function createNodeProcess(): ProcessPort {
  return {
    run(
      command: string,
      args: readonly string[],
      opts?: ProcessRunOptions,
    ): Promise<ProcessResult> {
      const { cwd, env, timeoutMs } = opts ?? {};
      return new Promise<ProcessResult>((resolve, reject) => {
        const child = spawn(command, [...args], {
          cwd,
          env: env as NodeJS.ProcessEnv | undefined,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let timer: NodeJS.Timeout | undefined;
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            child.kill();
            reject(
              new Error(`process "${command}" timed out after ${timeoutMs}ms`),
            );
          }, timeoutMs);
        }
        child.stdout!.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr!.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code ?? 0 });
        });
      });
    },

    spawnDetached(
      command: string,
      args: readonly string[],
      opts?: ProcessRunOptions,
    ): Promise<number> {
      const { cwd, env } = opts ?? {};
      return new Promise<number>((resolve, reject) => {
        const child = spawn(command, [...args], {
          cwd,
          env: env as NodeJS.ProcessEnv | undefined,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.once('error', reject);
        if (typeof child.pid === 'number') {
          child.unref();
          resolve(child.pid);
          return;
        }
        reject(new Error(`failed to spawn "${command}"`));
      });
    },
  };
}
