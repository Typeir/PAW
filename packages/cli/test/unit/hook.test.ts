/**
 * @fileoverview Unit tests for the `paw hook` bridge. They pin routing and
 * translation: an unknown host or event throws, a payload the connector cannot
 * place yields a bare continue, and a real Copilot payload flows through
 * handleEvent to the correct native output — allow, deny (permissionDecision),
 * and block (decision) — so `hook.ts` reaches 100%.
 *
 * @module @paw/cli/test/unit/hook
 */

import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '@paw/adapters';
import type { GateRunner, HandleDeps, HostConnector } from '@paw/core';
import { EXEMPT_TOOLS, runHook, type HookIo } from '../../src/hook.js';

/**
 * A stdin/stdout seam over a fixed payload, capturing what was written.
 *
 * @param payload - The JSON payload the host would pipe in.
 */
function io(payload: unknown): HookIo & { out: string[] } {
  const out: string[] = [];
  return {
    out,
    async readStdin() {
      return JSON.stringify(payload);
    },
    writeStdout(text) {
      out.push(text);
    },
  };
}

const cleanGates: GateRunner = {
  async runForFiles() {
    return {
      timestamp: 't',
      mode: 'changed-only',
      changedFiles: null,
      overall: 'PASS',
      summary: { totalGates: 0, passed: 0, failed: 0, totalFindings: 0, hasCritical: false },
      gates: [],
    };
  },
};

const failingGates: GateRunner = {
  async runForFiles() {
    return {
      timestamp: 't',
      mode: 'changed-only',
      changedFiles: null,
      overall: 'FAIL',
      summary: { totalGates: 1, passed: 0, failed: 1, totalFindings: 1, hasCritical: true },
      gates: [
        {
          gate: 'no-bad',
          passed: false,
          severity: 'critical',
          findings: [{ file: 'src/x.ts', rule: 'no-bad', message: 'BADCODE' }],
          stats: { filesChecked: 1, findingsCount: 1, durationMs: 0 },
        },
      ],
    };
  },
};

const deps = (over: Partial<HandleDeps> = {}): HandleDeps => ({
  store: createMemoryStore(),
  exemptTools: EXEMPT_TOOLS,
  isIgnored: () => false,
  gates: cleanGates,
  ...over,
});

describe('runHook — bad routing', () => {
  it('throws on an unknown host', async () => {
    await expect(runHook('nope', 'tool.pre', io({}), deps())).rejects.toThrow('unknown hook host');
  });

  it('throws on an unknown event', async () => {
    await expect(runHook('copilot', 'tool.bogus', io({}), deps())).rejects.toThrow('unknown hook event');
  });
});

describe('runHook — translation', () => {
  it('emits a bare continue when the connector cannot place the payload', async () => {
    const nullConnector: Record<string, HostConnector> = {
      copilot: { name: 'x', toEvent: () => null, fromResponse: () => ({}) },
    };
    const seam = io({});
    const code = await runHook('copilot', 'tool.pre', seam, deps(), nullConnector);
    expect(code).toBe(0);
    expect(JSON.parse(seam.out[0])).toEqual({ continue: true });
  });

  it('allows a clean pre-tool edit', async () => {
    const seam = io({ toolName: 'edit', toolInput: { filePath: 'src/other.ts' } });
    await runHook('copilot', 'tool.pre', seam, deps());
    expect(JSON.parse(seam.out[0])).toEqual({ continue: true });
  });

  it('denies a pre-tool edit while a violation stands on another file', async () => {
    const store = createMemoryStore();
    await store.raise(
      [{ id: 0, filePath: 'src/a.ts', rule: 'no-bad', message: 'BADCODE', indirectFix: false }],
      'sess-1',
    );
    const seam = io({ session_id: 'sess-1', toolName: 'edit', toolInput: { filePath: 'src/other.ts' } });
    await runHook('copilot', 'tool.pre', seam, deps({ store }));
    const output = JSON.parse(seam.out[0]);
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('src/a.ts');
  });

  it('blocks a post-tool edit that fails a gate', async () => {
    const seam = io({ session_id: 'sess-1', toolName: 'edit', toolInput: { filePath: 'src/x.ts' } });
    await runHook('copilot', 'tool.post', seam, deps({ gates: failingGates }));
    const output = JSON.parse(seam.out[0]);
    expect(output).toMatchObject({ continue: true, decision: 'block' });
    expect(output.reason).toContain('BADCODE');
  });
});
