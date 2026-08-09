/**
 * PAW Event Router Tests
 *
 * @fileoverview Routes each canonical event through the router against a fake
 * store — pre-tool allow, allow-with-nudge, deny, ignored-path allow, prompt L1
 * context and its empty and absent forms, and a non-acting event — so
 * `handleEvent.ts` reaches 100%.
 *
 * @module @paw/core/test/application/handleEvent
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import type { Violation } from '../../src/domain/violation.js';
import type { PawEvent } from '../../src/domain/event.js';
import type { GateRunner, StorePort } from '../../src/ports/index.js';
import {
  handleEvent,
  type HandleDeps,
} from '../../src/application/handleEvent.js';

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
          findings: [{ file: 'src/b.ts', rule: 'no-bad', message: 'BADCODE' }],
          stats: { filesChecked: 1, findingsCount: 1, durationMs: 0 },
        },
      ],
    };
  },
};

const toolPost = (): PawEvent => ({
  type: 'tool.post',
  sessionId: 'sess-1',
  toolName: 'edit',
  editedPaths: ['src/b.ts'],
  failed: false,
});

const store = (violations: Violation[]): StorePort => ({
  unresolvedFor: async () => violations,
  raise: async () => undefined,
  resolveForFile: async () => 0,
});

const deps = (over: Partial<HandleDeps> = {}): HandleDeps => ({
  store: store([]),
  exemptTools: new Set(['read_file']),
  isIgnored: () => false,
  ...over,
});

const toolPre = (over: Partial<Extract<PawEvent, { type: 'tool.pre' }>> = {}): PawEvent => ({
  type: 'tool.pre',
  sessionId: 'sess-1',
  toolName: 'edit',
  targetPaths: ['src/b.ts'],
  envMatch: null,
  ...over,
});

const direct: Violation = {
  id: 1,
  filePath: 'src/a.ts',
  rule: 'jsdoc',
  message: 'missing',
  indirectFix: false,
};
const indirect: Violation = { ...direct, indirectFix: true, message: 'missing test' };

describe('handleEvent', () => {
  it('allows a clean pre-tool event', async () => {
    expect(await handleEvent(toolPre(), deps())).toEqual({ kind: 'allow' });
  });

  it('allows with a nudge when only indirect violations remain', async () => {
    const r = await handleEvent(toolPre(), deps({ store: store([indirect]) }));
    expect(r.kind).toBe('allow');
    if (r.kind === 'allow') expect(r.additionalContext).toContain('missing test');
  });

  it('denies when a direct violation stands elsewhere', async () => {
    const r = await handleEvent(toolPre(), deps({ store: store([direct]) }));
    expect(r).toEqual({ kind: 'deny', reason: expect.stringContaining('src/a.ts') });
  });

  it('normalises an absolute target so fixing the violated file is allowed', async () => {
    const r = await handleEvent(
      toolPre({ targetPaths: ['C:/repo/src/a.ts'] }),
      deps({ store: store([direct]), toRelative: (p) => p.replace('C:/repo/', '') }),
    );
    expect(r).toEqual({ kind: 'allow' });
  });

  it('allows when every targeted path is pawignored', async () => {
    const r = await handleEvent(
      toolPre({ targetPaths: ['dist/x.js'] }),
      deps({ store: store([direct]), isIgnored: () => true }),
    );
    expect(r).toEqual({ kind: 'allow' });
  });

  it('injects L1 context on a prompt when a loader is present', async () => {
    const r = await handleEvent(
      { type: 'prompt.submitted', sessionId: 's', prompt: 'hi' },
      deps({ loadL1: async () => 'recent decisions…' }),
    );
    expect(r).toEqual({ kind: 'context', additionalContext: 'recent decisions…' });
  });

  it('is a noop when the L1 loader returns nothing', async () => {
    const r = await handleEvent(
      { type: 'prompt.submitted', sessionId: 's', prompt: 'hi' },
      deps({ loadL1: async () => '' }),
    );
    expect(r).toEqual({ kind: 'noop' });
  });

  it('is a noop for a prompt with no L1 loader', async () => {
    const r = await handleEvent(
      { type: 'prompt.submitted', sessionId: 's', prompt: 'hi' },
      deps(),
    );
    expect(r).toEqual({ kind: 'noop' });
  });

  it('runs the detector on a post-tool event when a runner is present', async () => {
    const r = await handleEvent(toolPost(), deps({ gates: failingGates }));
    expect(r).toEqual({ kind: 'block', reason: expect.stringContaining('BADCODE') });
  });

  it('is a noop for a post-tool event with no gate runner', async () => {
    expect(await handleEvent(toolPost(), deps())).toEqual({ kind: 'noop' });
  });

  it('is a noop for events it does not act on yet', async () => {
    const r = await handleEvent(
      { type: 'session.start', sessionId: 's', source: 'startup' },
      deps(),
    );
    expect(r).toEqual({ kind: 'noop' });
  });
});
