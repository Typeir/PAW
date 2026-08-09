/**
 * @fileoverview Unit tests for the daemon's per-hook handler. Core must not
 * depend on adapters or connectors, so these use an inline fake store and a
 * minimal fake connector — enough to pin the whole translate → decide →
 * translate path: an unknown host or an unplaceable payload yields a bare
 * continue, and a placeable one flows through handleEvent to allow / deny / block.
 * The real Copilot connector is exercised end-to-end in the cli and daemon tiers.
 *
 * @module @paw/core/test/application/dispatchHook
 */

import { describe, expect, it } from 'vitest';
import {
  dispatchHook,
  type DispatchHookDeps,
  type GateRunner,
  type HostConnector,
  type PawEvent,
  type StorePort,
  type Violation,
} from '../../src/index.js';

const fakeStore = (violations: Violation[] = []): StorePort => ({
  unresolvedFor: async () => violations,
  raise: async () => undefined,
  resolveForFile: async () => 0,
  outstanding: async () => violations,
  prune: async () => 0,
});

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

/**
 * A minimal connector: it names `tool.pre`/`tool.post`, builds the matching
 * event from `{ paths }`, and tags the response kind for assertion.
 */
const testConnector: HostConnector = {
  name: 'test',
  eventName: (type) => (type === 'tool.pre' ? 'PRE' : type === 'tool.post' ? 'POST' : null),
  toEvent: (raw): PawEvent | null => {
    const r = raw as { hookEventName?: string; paths?: string[] };
    const paths = r.paths ?? [];
    if (r.hookEventName === 'PRE') {
      return { type: 'tool.pre', sessionId: 'S', toolName: 'edit', targetPaths: paths, envMatch: null };
    }
    if (r.hookEventName === 'POST') {
      return { type: 'tool.post', sessionId: 'S', toolName: 'edit', editedPaths: paths, failed: false };
    }
    return null;
  },
  fromResponse: (resp) =>
    resp.kind === 'deny' || resp.kind === 'block'
      ? { kind: resp.kind, reason: resp.reason }
      : { kind: resp.kind },
};

const deps = (over: Partial<DispatchHookDeps> = {}): DispatchHookDeps => ({
  store: fakeStore(),
  exemptTools: new Set(['read_file']),
  isIgnored: () => false,
  gates: cleanGates,
  connectors: { test: testConnector },
  ...over,
});

describe('dispatchHook', () => {
  it('returns a bare continue for an unknown host', async () => {
    expect(await dispatchHook(deps(), { host: 'nope', event: 'tool.pre', payload: {} })).toEqual({
      continue: true,
    });
  });

  it('returns a bare continue when the event has no host name and the payload cannot be placed', async () => {
    expect(
      await dispatchHook(deps(), { host: 'test', event: 'session.start', payload: {} }),
    ).toEqual({ continue: true });
  });

  it('allows a clean pre-tool edit', async () => {
    const r = await dispatchHook(deps(), {
      host: 'test',
      event: 'tool.pre',
      payload: { paths: ['src/other.ts'] },
    });
    expect(r).toEqual({ kind: 'allow' });
  });

  it('denies a pre-tool edit while a violation stands elsewhere', async () => {
    const store = fakeStore([
      { id: 1, filePath: 'src/a.ts', rule: 'no-bad', message: 'BADCODE', indirectFix: false },
    ]);
    const r = (await dispatchHook(deps({ store }), {
      host: 'test',
      event: 'tool.pre',
      payload: { paths: ['src/other.ts'] },
    })) as { kind: string; reason: string };
    expect(r.kind).toBe('deny');
    expect(r.reason).toContain('src/a.ts');
  });

  it('blocks a post-tool edit that fails a gate', async () => {
    const r = (await dispatchHook(deps({ gates: failingGates }), {
      host: 'test',
      event: 'tool.post',
      payload: { paths: ['src/x.ts'] },
    })) as { kind: string; reason: string };
    expect(r.kind).toBe('block');
    expect(r.reason).toContain('BADCODE');
  });
});
