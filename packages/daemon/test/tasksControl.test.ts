/**
 * @fileoverview Cover the task sync control port: a delta by default and a full sweep on
 * `full: true`, a non-boolean `full` refused, a second request while one runs refused with 409,
 * and a thrown sync answering 500 with its message.
 *
 * @module @paw/daemon/test/tasksControl
 */

import { describe, expect, it } from 'vitest';
import type { BackendSyncReport } from '@paw/core';
import { tasksControl } from '../src/application/tasksControl.js';
import type { ControlRequest } from '../src/domain/control.js';

const req = (body: Record<string, unknown> = {}): ControlRequest => ({ body, query: undefined });

const REPORT: BackendSyncReport = {
  connector: 'openproject',
  ok: true,
  mode: 'delta',
  pulled: 1,
  removed: 0,
  refusals: [],
};

describe('tasksControl', () => {
  it('syncs as a delta by default and as a full sweep on full: true, answering the reports', async () => {
    const asked: boolean[] = [];
    const port = tasksControl(async (full) => {
      asked.push(full);
      return [REPORT];
    });
    const handler = port.handlers['POST /api/tasks/sync'];
    expect(await handler?.(req())).toEqual({ status: 200, body: { ok: true, reports: [REPORT] } });
    expect(await handler?.(req({ full: true }))).toEqual({ status: 200, body: { ok: true, reports: [REPORT] } });
    expect(asked).toEqual([false, true]);
  });

  it('refuses a full that is not a boolean', async () => {
    const port = tasksControl(async () => [REPORT]);
    expect(await port.handlers['POST /api/tasks/sync']?.(req({ full: 'yes' }))).toEqual({
      status: 422,
      body: { ok: false, reason: 'full must be a boolean' },
    });
  });

  it('refuses a second sync while one runs, then accepts once it finished', async () => {
    let release: () => void = () => undefined;
    const port = tasksControl(
      () =>
        new Promise<readonly BackendSyncReport[]>((resolve) => {
          release = () => resolve([REPORT]);
        }),
    );
    const handler = port.handlers['POST /api/tasks/sync'];
    const first = handler?.(req());
    expect(await handler?.(req())).toEqual({
      status: 409,
      body: { ok: false, reason: 'a sync is already running; wait for it to finish' },
    });
    release();
    expect(await first).toMatchObject({ status: 200 });
    const third = handler?.(req());
    release();
    expect(await third).toMatchObject({ status: 200 });
  });

  it('answers 500 with the message when the sync throws, and frees the lock', async () => {
    let calls = 0;
    const port = tasksControl(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('.paw/backend-sync.json is not valid JSON: SyntaxError');
      }
      throw 'plain failure';
    });
    const handler = port.handlers['POST /api/tasks/sync'];
    expect(await handler?.(req())).toEqual({
      status: 500,
      body: { ok: false, reason: '.paw/backend-sync.json is not valid JSON: SyntaxError' },
    });
    expect(await handler?.(req())).toEqual({ status: 500, body: { ok: false, reason: 'plain failure' } });
  });
});
