/**
 * PAW Enforcement Control Bridge Tests
 *
 * @fileoverview The console's write verbs as round trips to pawd, driven through
 * a fake `rpc` so both outcomes are pinned: a daemon that answers passes its
 * result through with the verb's status (200 for a prune, 202 for a stop); a
 * daemon that does not answer — a null round trip — becomes a 503 the console can
 * explain. A prune threads the `file` query, or prunes all when none is given. The
 * scope is resolved per call and passed to `rpc`, so a getter that changes between
 * calls proves the console follows whichever consumer it currently holds. One case
 * omits the seam so the real socket call runs against a dead endpoint and fails
 * open, keeping the default covered. So `enforcementControl.ts` reaches 100%.
 *
 * @module @paw/daemon/test/enforcementControl
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it, vi } from 'vitest';
import { enforcementControl } from '../src/application/enforcementControl.js';

const prune = 'DELETE /api/violations';
const stop = 'POST /api/daemon/stop';

describe('enforcementControl', () => {
  it('prunes all violations, passing no file to pawd', async () => {
    const rpc = vi.fn(async () => ({ cleared: 9 }));
    const res = await enforcementControl('/repo', { rpc }).handlers[prune]({
      query: undefined,
      body: {},
    });
    expect(rpc).toHaveBeenCalledWith('violations.prune', {}, '/repo');
    expect(res).toEqual({ status: 200, body: { cleared: 9 } });
  });

  it('prunes one file, threading the file query through to pawd', async () => {
    const rpc = vi.fn(async () => ({ cleared: 1 }));
    const res = await enforcementControl('/repo', { rpc }).handlers[prune]({
      query: new URLSearchParams('file=src/a.ts'),
      body: {},
    });
    expect(rpc).toHaveBeenCalledWith('violations.prune', { file: 'src/a.ts' }, '/repo');
    expect(res.status).toBe(200);
  });

  it('stops the enforcement daemon, answering 202', async () => {
    const rpc = vi.fn(async () => ({ stopping: true }));
    const res = await enforcementControl('/repo', { rpc }).handlers[stop]({
      query: undefined,
      body: {},
    });
    expect(rpc).toHaveBeenCalledWith('daemon.stop', {}, '/repo');
    expect(res).toEqual({ status: 202, body: { stopping: true } });
  });

  it('resolves the scope the console currently holds, per call', async () => {
    const rpc = vi.fn(async () => ({ cleared: 0 }));
    let held = '/consumer-a';
    const port = enforcementControl(() => held, { rpc });
    await port.handlers[prune]({ query: undefined, body: {} });
    expect(rpc).toHaveBeenLastCalledWith('violations.prune', {}, '/consumer-a');
    held = '/consumer-b';
    await port.handlers[stop]({ query: undefined, body: {} });
    expect(rpc).toHaveBeenLastCalledWith('daemon.stop', {}, '/consumer-b');
  });

  it('answers 503 when pawd does not respond, on either verb', async () => {
    const rpc = vi.fn(async () => null);
    const port = enforcementControl('/repo', { rpc });
    for (const key of [prune, stop]) {
      const res = await port.handlers[key]({ query: undefined, body: {} });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: expect.stringContaining('no enforcement daemon') });
    }
  });

  it('falls open to 503 through the real socket when no daemon is running', async () => {
    const res = await enforcementControl('/no/such/repo').handlers[prune]({
      query: undefined,
      body: {},
    });
    expect(res.status).toBe(503);
  });
});
