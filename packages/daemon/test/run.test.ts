/**
 * Run Reporting Tests
 *
 * @fileoverview What the console is told about a run: the token meter counts
 * what the port actually carried and lets a failure through, and a finished
 * dispatch maps to the herd exactly as core reported it — no member is invented,
 * and a refused plan reports an empty herd rather than a hopeful one.
 *
 * @module @paw/daemon/test/run
 */

import type { DispatchEvent, DispatchResult, ModelPort } from '@paw/core';
import { describe, expect, it } from 'vitest';
import { meterPort, toRunProgress, trackRun } from '../src/application/run.js';

const inner: ModelPort = {
  complete: async (request) => ({
    content: `ran: ${request.prompt}`,
    inputTokens: request.prompt.length,
    outputTokens: 2,
  }),
};

describe('meterPort', () => {
  it('counts nothing before a call and totals every call after', async () => {
    const metered = meterPort(inner);
    expect(metered.usage()).toEqual({ spendUsd: 0, tokensIn: 0, tokensOut: 0 });

    await metered.port.complete({ model: 'm', prompt: 'abc' });
    await metered.port.complete({ model: 'm', prompt: 'de' });

    expect(metered.usage()).toEqual({ spendUsd: 0, tokensIn: 5, tokensOut: 4 });
  });

  it('passes the model’s answer through untouched', async () => {
    const metered = meterPort(inner);
    await expect(metered.port.complete({ model: 'm', prompt: 'hi' })).resolves.toMatchObject({
      content: 'ran: hi',
    });
  });

  it('lets a failed call through instead of counting it as free', async () => {
    const broken: ModelPort = {
      complete: async () => {
        throw new Error('provider down');
      },
    };
    const metered = meterPort(broken);
    await expect(metered.port.complete({ model: 'm', prompt: 'hi' })).rejects.toThrow(
      'provider down',
    );
    expect(metered.usage().tokensIn).toBe(0);
  });
});

describe('toRunProgress', () => {
  it('maps outcomes to the herd, counting done, skipped, and confirmed', () => {
    const result: DispatchResult = {
      released: true,
      findings: [],
      outcomes: [
        { member: 0, key: 'a.mdx', state: 'done', content: 'wrote a' },
        { member: 1, key: 'b.mdx', state: 'skipped' },
        { member: 2, key: 'c.mdx', state: 'done', content: 'wrote c' },
      ],
    };
    expect(toRunProgress(result, '15-40-02', '2026-08-05T15:40:02.000Z')).toEqual({
      id: '15-40-02',
      startedAt: '2026-08-05T15:40:02.000Z',
      skipped: 1,
      done: 2,
      running: 0,
      failed: 0,
      confirmed: 2,
      members: [
        { member: 0, key: 'a.mdx', state: 'done', level: null },
        { member: 1, key: 'b.mdx', state: 'skipped', level: null },
        { member: 2, key: 'c.mdx', state: 'done', level: null },
      ],
    });
  });

  it('reports an empty herd for a plan the doctor refused', () => {
    const refused: DispatchResult = {
      released: false,
      findings: [{ check: 'count', ok: false }],
      outcomes: [],
    };
    expect(toRunProgress(refused, 'r', 't')).toMatchObject({
      done: 0,
      skipped: 0,
      confirmed: 0,
      members: [],
    });
  });
});

describe('trackRun', () => {
  /**
   * The event a dispatcher emits when a member begins.
   *
   * @param {number} member - The member index.
   * @param {number} total - The plan's member count.
   * @returns {DispatchEvent} The event.
   */
  const started = (member: number, total = 3): DispatchEvent => ({
    phase: 'started',
    member,
    key: `m${member}.mdx`,
    total,
  });

  /**
   * The event a dispatcher emits when a member settles.
   *
   * @param {number} member - The member index.
   * @param {'done' | 'skipped'} state - How it finished.
   * @param {string} [content] - What the model returned.
   * @returns {DispatchEvent} The event.
   */
  const settled = (
    member: number,
    state: 'done' | 'skipped',
    content?: string,
  ): DispatchEvent => ({
    phase: 'settled',
    member,
    key: `m${member}.mdx`,
    total: 3,
    outcome: { member, key: `m${member}.mdx`, state, ...(content === undefined ? {} : { content }) },
  });

  it('reports a member as running from the moment it starts', () => {
    const tracker = trackRun('r', 't');
    const progress = tracker.apply(started(0));

    expect(progress.running).toBe(1);
    expect(progress.done).toBe(0);
    expect(progress.members).toEqual([{ member: 0, key: 'm0.mdx', state: 'running', level: null }]);
  });

  it('moves a member out of running when it settles', () => {
    const tracker = trackRun('r', 't');
    tracker.apply(started(0));
    const progress = tracker.apply(settled(0, 'done', 'output'));

    expect(progress.running).toBe(0);
    expect(progress.done).toBe(1);
    expect(progress.confirmed).toBe(1);
    expect(progress.members).toEqual([{ member: 0, key: 'm0.mdx', state: 'done', level: null }]);
  });

  it('counts a skip as settled but neither done nor confirmed', () => {
    const tracker = trackRun('r', 't');
    tracker.apply(started(0));
    const progress = tracker.apply(settled(0, 'skipped'));

    expect(progress.skipped).toBe(1);
    expect(progress.done).toBe(0);
    expect(progress.confirmed).toBe(0);
  });

  it('counts a member that ran but returned nothing as done, not confirmed', () => {
    const tracker = trackRun('r', 't');
    tracker.apply(started(0));
    const progress = tracker.apply(settled(0, 'done'));

    // `confirmed` is output actually captured, which is the number an operator
    // is watching — a member that answered with nothing did not produce work.
    expect(progress.done).toBe(1);
    expect(progress.confirmed).toBe(0);
  });

  it('keeps members in plan order however the events interleave', () => {
    const tracker = trackRun('r', 't');
    tracker.apply(started(0));
    tracker.apply(started(2));
    tracker.apply(settled(2, 'done', 'x'));
    tracker.apply(started(1));
    const progress = tracker.apply(settled(0, 'skipped'));

    expect(progress.members.map((m) => m.member)).toEqual([0, 1, 2]);
    expect(progress.members.map((m) => m.state)).toEqual(['skipped', 'running', 'done']);
    expect(progress.running).toBe(1);
  });

  it('agrees with the finished result once every member has settled', () => {
    const tracker = trackRun('r', 't');
    for (const member of [0, 1, 2]) {
      tracker.apply(started(member));
    }
    tracker.apply(settled(0, 'done', 'a'));
    tracker.apply(settled(1, 'skipped'));
    tracker.apply(settled(2, 'done', 'c'));

    const result: DispatchResult = {
      released: true,
      findings: [],
      outcomes: [
        { member: 0, key: 'm0.mdx', state: 'done', content: 'a' },
        { member: 1, key: 'm1.mdx', state: 'skipped' },
        { member: 2, key: 'm2.mdx', state: 'done', content: 'c' },
      ],
    };

    // The live view and the authoritative end-of-run view must not disagree, or
    // the console visibly changes its mind at the moment the run finishes.
    expect(tracker.progress()).toEqual(toRunProgress(result, 'r', 't'));
  });

  it('ignores a settled event that carries no outcome', () => {
    const tracker = trackRun('r', 't');
    tracker.apply(started(0));
    const progress = tracker.apply({ phase: 'settled', member: 0, key: 'm0.mdx', total: 3 });

    expect(progress.running).toBe(0);
    expect(progress.members).toEqual([]);
  });

  it('starts empty', () => {
    expect(trackRun('r', 't').progress()).toEqual({
      id: 'r',
      startedAt: 't',
      skipped: 0,
      done: 0,
      running: 0,
      failed: 0,
      confirmed: 0,
      members: [],
    });
  });
});
