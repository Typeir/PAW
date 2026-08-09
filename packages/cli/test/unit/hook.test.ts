/**
 * @fileoverview Unit tests for the thin hook bridge. With the RPC call injected,
 * they pin the only logic left in the client: a valid payload is forwarded and
 * the daemon's answer written; a null (fail-open) answer becomes a bare continue;
 * a malformed or non-object payload is sent as empty. So `hook.ts` reaches 100%.
 *
 * @module @paw/cli/test/unit/hook
 */

import { describe, expect, it } from 'vitest';
import { runHook, type HookIo, type HookOptions } from '../../src/hook.js';

const io = (stdin: string): HookIo & { out: string[] } => {
  const out: string[] = [];
  return { out, readStdin: async () => stdin, writeStdout: (t) => out.push(t) };
};

/** A fake RPC call that records the params it was given and returns `ret`. */
const fakeCall = (ret: unknown | null) => {
  const params: unknown[] = [];
  const call: typeof import('@paw/daemon').rpcCall = async (_s, _t, _m, p) => {
    params.push(p);
    return ret;
  };
  return { call, params };
};

const base = (io_: HookIo, call: HookOptions['call']): HookOptions => ({
  host: 'copilot',
  event: 'tool.pre',
  socketPath: 'sock',
  tokenPath: 'tok',
  io: io_,
  call,
});

describe('runHook (thin client)', () => {
  it('forwards a valid payload and writes the daemon answer', async () => {
    const seam = io(JSON.stringify({ toolName: 'edit' }));
    const f = fakeCall({ continue: true, decision: 'block' });
    await runHook(base(seam, f.call));
    expect(JSON.parse(seam.out[0])).toEqual({ continue: true, decision: 'block' });
    expect(f.params[0]).toMatchObject({ host: 'copilot', event: 'tool.pre', payload: { toolName: 'edit' } });
  });

  it('fails open to continue when the call yields null', async () => {
    const seam = io('{}');
    await runHook(base(seam, async () => null));
    expect(JSON.parse(seam.out[0])).toEqual({ continue: true });
  });

  it('sends an empty payload for a malformed body', async () => {
    const seam = io('not json');
    const f = fakeCall({ continue: true });
    await runHook(base(seam, f.call));
    expect((f.params[0] as { payload: unknown }).payload).toEqual({});
  });

  it('sends an empty payload for a non-object body', async () => {
    const seam = io('42');
    const f = fakeCall({ continue: true });
    await runHook(base(seam, f.call));
    expect((f.params[0] as { payload: unknown }).payload).toEqual({});
  });
});
