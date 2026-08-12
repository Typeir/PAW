/**
 * Live Event Application Tests
 *
 * @fileoverview Check slice replace own field only, touch nothing else. Topic console does not render as data: state unchanged. New daemon topic ignored by console that does not know it.
 *
 * @module @paw/gui/test/unit/application/applyLiveEvent
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { LiveEnvelope, LiveTopic, PlanSlice } from '@paw/core';
import { describe, expect, it } from 'vitest';
import { applyLiveEvent } from '../../../src/application/applyLiveEvent.js';
import { hydrate } from '../../../src/application/hydrateSnapshot.js';
import { makeSnapshot } from '../../fixtures.js';

const DATA = hydrate(makeSnapshot());

/**
 * Envelope carry topic new value.
 *
 * @param {LiveTopic} topic - The topic.
 * @param {unknown} data - Its value.
 * @returns {LiveEnvelope} The envelope.
 */
const frame = (topic: LiveTopic, data: unknown): LiveEnvelope =>
  ({ v: 1, topic, at: 1786060800000, data }) as LiveEnvelope;

describe('applyLiveEvent', () => {
  it('replaces the whole state on hello, through the same apply path a poll event uses', () => {
    const next = applyLiveEvent(DATA, frame('hello', makeSnapshot({ planName: 'moved-on' })));
    expect(next.plan.name).toBe('moved-on');
  });

  it('enforces the producer contract on hello, exactly as hydration does', () => {
    const broken = makeSnapshot({ memberTotal: 9 });
    // Daemon sends nine members but four briefs: producer defect. Console renders the four received and so would not surface the nine-member declaration, so applyLiveEvent throws instead.
    expect(() => applyLiveEvent(DATA, frame('hello', broken))).toThrow('declares 9 members');
  });

  it('replaces the host and leaves everything else identical', () => {
    const host = { ...DATA.host, uptimeSec: 99999 };
    const next = applyLiveEvent(DATA, frame('host', host));

    expect(next.host).toBe(host);
    expect(next.processes).toBe(DATA.processes);
    expect(next.plan).toBe(DATA.plan);
    expect(next.run).toBe(DATA.run);
    expect(next.doctor).toBe(DATA.doctor);
  });

  it('replaces the process table', () => {
    const processes = [{ pid: 7, ppid: 1, name: 'worker' }];
    expect(applyLiveEvent(DATA, frame('processes', processes)).processes).toBe(processes);
  });

  it('replaces the plan list and the config path together', () => {
    const next = applyLiveEvent(
      DATA,
      frame('plans', { plans: ['a.swarm.mjs'], configPath: 'other.json' }),
    );
    expect(next.plans).toEqual(['a.swarm.mjs']);
    expect(next.configPath).toBe('other.json');
    expect(next.plan).toBe(DATA.plan);
  });

  it('replaces the whole plan slice, including which plan is selected', () => {
    const slice: PlanSlice = {
      selectedPlan: 'plans/lore.swarm.mjs',
      planName: 'lore',
      planRole: 'edit.apply',
      memberTotal: 1,
      planSource: 'export default {}',
      highlightLine: 3,
      briefs: ['only brief'],
      slugs: ['only-slug'],
      planFindings: [],
    };
    const next = applyLiveEvent(DATA, frame('planDetail', slice));

    expect(next.selectedPlan).toBe('plans/lore.swarm.mjs');
    expect(next.plan).toEqual({
      name: 'lore',
      role: 'edit.apply',
      total: 1,
      source: 'export default {}',
      highlightLine: 3,
      briefs: ['only brief'],
      slugs: ['only-slug'],
    });
    expect(next.checks).toEqual([]);
    expect(next.host).toBe(DATA.host);
  });

  it('replaces the doctor, the run, and the budget one at a time', () => {
    const doctor = { ...DATA.doctor, ok: false };
    const run = { ...DATA.run, done: 41 };
    const budget = { spendUsd: 1, tokensIn: 2, tokensOut: 3 };

    expect(applyLiveEvent(DATA, frame('doctor', doctor)).doctor).toBe(doctor);
    expect(applyLiveEvent(DATA, frame('run', run)).run).toBe(run);
    expect(applyLiveEvent(DATA, frame('budget', budget)).budget).toBe(budget);
  });

  it('takes the served repository from a landed scope, and only from one', () => {
    expect(
      applyLiveEvent(DATA, frame('attach', { status: 'idle', path: 'C:\\code\\next' })).root,
    ).toBe('C:\\code\\next');
    expect(
      applyLiveEvent(DATA, frame('attach', { status: 'unconfigured', path: '/work/raw' })).root,
    ).toBe('/work/raw');
    // Request in flight or refused, or idle with no path, change nothing.
    expect(applyLiveEvent(DATA, frame('attach', { status: 'failed', path: '/nope' }))).toBe(DATA);
    expect(applyLiveEvent(DATA, frame('attach', { status: 'idle', path: null }))).toBe(DATA);
  });

  it('changes nothing for a topic the console does not render as data', () => {
    for (const topic of ['tree', 'error'] as const) {
      // Return input identical so an unknown daemon topic cannot alter data a console does not render; reducer then skips re-render.
      expect(applyLiveEvent(DATA, frame(topic, { anything: true }))).toBe(DATA);
    }
  });

  it('appends log frames, capped at the daemon ring size', () => {
    const entry = { at: '2026-08-05T15:41:00.000Z', level: 'info' as const, message: 'fresh' };
    const appended = applyLiveEvent(DATA, frame('log', [entry]));
    expect(appended.logs[appended.logs.length - 1]).toEqual(entry);
    expect(appended.logs.length).toBe(DATA.logs.length + 1);

    const flood = Array.from({ length: 250 }, (_v, i) => ({
      at: `2026-08-05T15:41:${String(i % 60).padStart(2, '0')}.000Z`,
      level: 'info' as const,
      message: `m${i}`,
    }));
    const capped = applyLiveEvent(DATA, frame('log', flood));
    expect(capped.logs.length).toBe(200);
    expect(capped.logs[capped.logs.length - 1].message).toBe('m249');
  });

  it('never mutates the data it was given', () => {
    const before = JSON.stringify(DATA);
    applyLiveEvent(DATA, frame('host', { ...DATA.host, pid: 1 }));
    applyLiveEvent(DATA, frame('processes', []));
    expect(JSON.stringify(DATA)).toBe(before);
  });
});
