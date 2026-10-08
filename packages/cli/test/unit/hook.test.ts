/**
 * @fileoverview Unit tests for thin hook bridge. Inject RPC call, pin client
 * logic: forward valid payload, write daemon answer; null (fail-open) answer
 * become bare continue; malformed or non-object payload send empty; any throw
 * around the call become bare continue and exit 0. `hook.ts` reach 100%.
 *
 * @module @paw/cli/test/unit/hook
 */

import { describe, expect, it } from 'vitest';
import { failOpen, runHook, type HookIo, type HookOptions } from '../../src/application/hook.js';

const io = (stdin: string): HookIo & { out: string[] } => {
  const out: string[] = [];
  return { out, readStdin: async () => stdin, writeStdout: (t) => out.push(t) };
};

/** Fake RPC call. Record params it get. Return `ret`. */
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

describe('failOpen', () => {
  const sink = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, writeStdout: (t: string) => out.push(t), writeStderr: (t: string) => err.push(t) };
  };

  it('returns the exit code of the invocation and writes nothing of its own', async () => {
    const s = sink();
    expect(await failOpen(async () => 0, s)).toBe(0);
    expect(s.out).toEqual([]);
    expect(s.err).toEqual([]);
  });

  it('turns a thrown error into do-nothing output, exit 0, and the reason on stderr', async () => {
    const s = sink();
    const code = await failOpen(async () => {
      throw new Error('lock file unreadable');
    }, s);
    expect(code).toBe(0);
    expect(s.out).toEqual([JSON.stringify({ continue: true })]);
    expect(s.err.join('')).toContain('lock file unreadable');
    expect(s.err.join('')).toContain('allowed without enforcement');
  });

  it('names a thrown non-error value', async () => {
    const s = sink();
    expect(
      await failOpen(async () => {
        throw 'socket gone';
      }, s),
    ).toBe(0);
    expect(s.err.join('')).toContain('socket gone');
  });
});
