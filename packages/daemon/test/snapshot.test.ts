/**
 * PAW Daemon Snapshot Tests
 *
 * @fileoverview Covers `formatUptime` (hours/minutes/seconds arms) and
 * `buildSnapshot` — that it pre-renders a brief and slug per member, runs the real
 * doctor and plan doctor, and derives the daemon pill from the host facts without
 * inventing a run — so `snapshot.ts` reaches 100%.
 *
 * @module @paw/daemon/test/snapshot
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildRegistry,
  type HostInfo,
  type ModelCapabilities,
  type ModelPort,
  type SwarmPlan,
} from '@paw/core';
import { buildSnapshot, formatUptime, type SnapshotInputs } from '../src/snapshot.js';

const port: ModelPort = { complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }) };
const CAP: ModelCapabilities = {
  contextTokens: 128_000,
  maxOutputTokens: 16_384,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: false,
  costClass: 'cheap',
};

const plan: SwarmPlan<{ files: string[] }> = {
  name: 'demo',
  role: 'edit.apply',
  args: { files: ['a.mdx', 'b.mdx'] },
  members: 2,
  brief: (a, m, n) => `member ${m + 1}/${n}: ${a.files[m]}`,
  key: (a, m) => a.files[m],
  expectFiles: (a, m) => a.files[m],
};

const host: HostInfo = {
  pid: 99,
  ppid: 1,
  uptimeSec: 8000,
  rssBytes: 96 * 1024 * 1024,
  hostname: 'anvil',
  platform: 'win32',
  release: '10',
  cpus: 8,
  node: 'v22',
  cwd: '/w',
};

const inputs: SnapshotInputs = {
  host,
  processes: [{ pid: 1, ppid: 0, name: 'init' }],
  config: {
    root: '.paw',
    gatesDir: '.paw/gates',
    connector: 'copilot-hooks',
    models: { ds: CAP },
    roles: { 'edit.apply': 'ds', 'review.graze': 'ds', 'review.judge': 'ds' },
  },
  configPath: '.paw/config.json',
  plans: ['plans/demo.swarm.mjs', 'plans/other.swarm.mjs'],
  selectedPlan: 'plans/demo.swarm.mjs',
  plan: plan as SwarmPlan<unknown>,
  planSource: `export default { name: 'demo' };`,
  registry: buildRegistry(
    { models: { ds: CAP }, roles: { 'edit.apply': 'ds', 'review.graze': 'ds', 'review.judge': 'ds' } },
    () => port,
  ),
  knownConnectors: ['copilot-hooks'],
  socket: '127.0.0.1:8971',
  violations: [],
  gates: 0,
  keys: 1,
  runId: '15-40-02',
  startedAt: '2026-08-05T15:40:02Z',
};

describe('formatUptime', () => {
  it('renders hours, minutes, and seconds', () => {
    expect(formatUptime(8000)).toBe('2h13m');
    expect(formatUptime(125)).toBe('2m05s');
    expect(formatUptime(9)).toBe('09s');
  });
});

describe('buildSnapshot', () => {
  const snap = buildSnapshot(inputs);

  it('pre-renders a brief and slug for every member', () => {
    expect(snap.memberTotal).toBe(2);
    expect(snap.briefs).toEqual(['member 1/2: a.mdx', 'member 2/2: b.mdx']);
    expect(snap.slugs).toEqual(['a.mdx', 'b.mdx']);
  });

  it('runs the real doctor and plan doctor', () => {
    expect(snap.doctor.ok).toBe(true);
    expect(snap.planFindings.map((f) => f.check)).toContain('file-conflict');
  });

  it('carries the repository: where the config is and every plan in it', () => {
    expect(snap.configPath).toBe('.paw/config.json');
    expect(snap.plans).toEqual(['plans/demo.swarm.mjs', 'plans/other.swarm.mjs']);
    expect(snap.selectedPlan).toBe('plans/demo.swarm.mjs');
    expect(snap.planName).toBe('demo');
  });

  it('reports an unselected plan as absent rather than as an empty plan', () => {
    const none = buildSnapshot({ ...inputs, plan: null, selectedPlan: null, planSource: '' });
    expect(none.selectedPlan).toBeNull();
    expect(none.planName).toBe('');
    expect(none.planRole).toBe('');
    expect(none.memberTotal).toBe(0);
    expect(none.briefs).toEqual([]);
    expect(none.slugs).toEqual([]);
    expect(none.planFindings).toEqual([]);
    expect(none.plans).toHaveLength(2);
    expect(none.doctor.ok).toBe(true);
  });

  it('derives the daemon pill from the host facts and invents no run', () => {
    expect(snap.daemon).toMatchObject({ pid: 99, socket: '127.0.0.1:8971', rssMb: 96, uptimeLabel: '2h13m', proto: 'v1' });
    expect(snap.run).toMatchObject({ done: 0, running: 0, failed: 0, skipped: 0, members: [] });
    expect(snap.budget).toEqual({ spendUsd: 0, tokensIn: 0, tokensOut: 0 });
    expect(snap.chrome).toEqual({ gates: 0, keys: 1 });
    expect(snap.host).toBe(host);
    expect(snap.processes).toHaveLength(1);
  });
});
