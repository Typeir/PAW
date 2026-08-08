/**
 * @fileoverview End-to-end proof of PAW's enforcement loop, driven exactly as a
 * host would drive it: a Copilot payload on stdin, through `runHook`, out as the
 * host's native decision. Every component is real — the copilot connector, the
 * event router, the node gate runner over a written-out `.paw/gates` project, and
 * the violation store. The only substitutions are the in-memory store (the
 * canonical semantics the SQL store matches, shared here to stand in for
 * cross-process persistence) and an in-process call instead of a spawned binary.
 *
 * The loop proven, in order: a bad edit is detected and blocked; that violation
 * then denies edits to OTHER files while allowing edits to the violating file so
 * it can be fixed; fixing it clears the violation; and the gate is open again.
 *
 * @module @paw/cli/test/e2e/enforcementLoop
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStore, createNodeGateRunner } from '@paw/adapters';
import type { HandleDeps, StorePort } from '@paw/core';
import { EXEMPT_TOOLS, runHook, type HookIo } from '../../src/hook.js';

const NO_BAD_GATE = `export const gate = {
  id: 'no-bad', name: 'No BADCODE', port: 'code-quality',
  severity: 'critical', appliesTo: ['.ts'],
  async check(ctx) {
    const findings = [];
    for (const file of await ctx.targetFiles(['.ts'])) {
      (await ctx.readFile(file)).split('\\n').forEach((line, i) => {
        if (line.includes('BADCODE')) findings.push({ file, line: i + 1, rule: 'no-bad', message: 'BADCODE is forbidden' });
      });
    }
    return { gate: 'no-bad', passed: findings.length === 0, severity: 'critical', findings, stats: { filesChecked: 1, findingsCount: findings.length, durationMs: 0 } };
  },
};
`;

let root: string;
let store: StorePort;
let deps: HandleDeps;

/**
 * Write a file under the temp project, creating parents.
 *
 * @param rel - Path relative to the project root.
 * @param body - File content.
 */
function write(rel: string, body: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/**
 * Drive one hook invocation the way Copilot would, returning the parsed output.
 *
 * @param event - The canonical event the command names.
 * @param file - The file the tool touched.
 */
async function hook(event: string, file: string): Promise<Record<string, unknown>> {
  const out: string[] = [];
  const io: HookIo = {
    async readStdin() {
      return JSON.stringify({ session_id: 'S', toolName: 'edit', toolInput: { filePath: file } });
    },
    writeStdout(text) {
      out.push(text);
    },
  };
  await runHook('copilot', event, io, deps);
  return JSON.parse(out[0]) as Record<string, unknown>;
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'paw-e2e-'));
  write('.paw/gates/no-bad.gate.mjs', NO_BAD_GATE);
  write('src/x.ts', 'export const x = 1; // BADCODE\n');
  write('src/other.ts', 'export const y = 2;\n');
  store = createMemoryStore();
  deps = {
    store,
    gates: createNodeGateRunner(root),
    exemptTools: EXEMPT_TOOLS,
    isIgnored: () => false,
  };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PAW enforcement loop, end to end', () => {
  it('detects a bad edit, blocks other work until fixed, then reopens', async () => {
    const detected = await hook('tool.post', 'src/x.ts');
    expect(detected).toMatchObject({ continue: true, decision: 'block' });
    expect(String(detected.reason)).toContain('BADCODE');

    const deniedElsewhere = await hook('tool.pre', 'src/other.ts');
    const denyOut = deniedElsewhere.hookSpecificOutput as Record<string, unknown>;
    expect(denyOut.permissionDecision).toBe('deny');
    expect(String(denyOut.permissionDecisionReason)).toContain('src/x.ts');

    const allowedOnViolated = await hook('tool.pre', 'src/x.ts');
    expect(allowedOnViolated).toEqual({ continue: true });

    const readOnlyAlways = await hook('tool.pre', 'src/other.ts');
    expect(readOnlyAlways.hookSpecificOutput).toBeDefined();

    write('src/x.ts', 'export const x = 1;\n');
    const cleared = await hook('tool.post', 'src/x.ts');
    expect(cleared).toEqual({ continue: true });

    const reopened = await hook('tool.pre', 'src/other.ts');
    expect(reopened).toEqual({ continue: true });
  });

  it('never blocks an exempt read-only tool, even mid-violation', async () => {
    await store.raise(
      [{ id: 0, filePath: 'src/x.ts', rule: 'no-bad', message: 'BADCODE', indirectFix: false }],
      'S',
    );
    const out: string[] = [];
    const io: HookIo = {
      async readStdin() {
        return JSON.stringify({ session_id: 'S', toolName: 'read_file', toolInput: { filePath: 'src/other.ts' } });
      },
      writeStdout(text) {
        out.push(text);
      },
    };
    await runHook('copilot', 'tool.pre', io, deps);
    expect(JSON.parse(out[0])).toEqual({ continue: true });
    await store.resolveForFile('src/x.ts', 'S');
  });
});
