/**
 * PAW Apply Init Tests
 *
 * @fileoverview Cover `init` when `.paw/config.json` already exist. Pin that
 * refusal still plan git hook and get reported, and that `--merge` and
 * `--override` reach planner.
 *
 * @module @paw/core/test/application/applyInit
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { stampConfig } from '../../src/domain/initConfig.js';
import { describe, expect, it, vi } from 'vitest';
import { applyInit, readInitPlan } from '../../src/application/applyInit.js';
import type { FileSystemPort } from '../../src/ports/index.js';
import { configPathFor, ignorePathFor, planInit } from '../../src/domain/initScaffold.js';

const ROOT = '/repo';
const EXISTING = '{"surface":"all","runners":{".gate.ts":"tsx"}}';

/**
 * Filesystem fake. `readText` serve fixed config and ignore file. Records writes.
 *
 * @param configText - What `readText` return for `.paw/config.json`.
 * @param ignoreText - What `readText` return for any other path.
 * @returns The port and write spy.
 */
function fakeFs(configText: string, ignoreText = '') {
  const writeText = vi.fn(async () => {});
  const fs: FileSystemPort = {
    readText: async (path) => (path === configPathFor(ROOT) ? configText : ignoreText),
    writeText,
    appendText: async () => {},
    ensureDir: async () => {},
    setExecutable: async () => {},
  };
  return { fs, writeText };
}

describe('planInit with an existing config', () => {
  it('plans all three files when nothing is there', () => {
    const plan = planInit(ROOT, null, 'create');
    expect(plan.writes).toHaveLength(3);
    expect(plan.refusal).toBeUndefined();
  });

  it('refuses an unstamped config but still plans the hook and the ignore file', () => {
    const plan = planInit(ROOT, EXISTING, 'create');
    expect(plan.refusal?.conflict.kind).toBe('unstamped');
    expect(plan.writes.map((w) => w.path)).toEqual([
      '/repo/.git/hooks/pre-commit',
      ignorePathFor(ROOT),
    ]);
  });

  it('refuses a config it wrote itself', () => {
    const plan = planInit(ROOT, stampConfig({ root: '.paw' }), 'create');
    expect(plan.refusal?.conflict.kind).toBe('stamped');
  });

  it('merges on request, keeping the operator’s keys', () => {
    const plan = planInit(ROOT, EXISTING, 'merge');
    expect(plan.refusal).toBeUndefined();
    const config = plan.writes.find((w) => w.path === configPathFor(ROOT));
    const parsed = JSON.parse(config?.content ?? '{}') as Record<string, unknown>;
    expect(parsed.runners).toEqual({ '.gate.ts': 'tsx' });
    expect(parsed.connector).toBe('copilot-hooks');
  });

  it('overrides on request, dropping them', () => {
    const plan = planInit(ROOT, EXISTING, 'override');
    const config = plan.writes.find((w) => w.path === configPathFor(ROOT));
    const parsed = JSON.parse(config?.content ?? '{}') as Record<string, unknown>;
    expect(parsed.runners).toBeUndefined();
  });

  it('defaults to refusing when no mode is given', () => {
    expect(planInit(ROOT, EXISTING).refusal).toBeDefined();
  });
});

describe('applyInit with an existing config', () => {
  it('does not write the config it refused to replace', async () => {
    const { fs, writeText } = fakeFs(EXISTING);
    const plan = await applyInit(ROOT, fs);
    expect(plan.refusal).toBeDefined();
    const written = writeText.mock.calls.map((c) => (c as unknown as string[])[0]);
    expect(written.some((p) => p.includes('config.json'))).toBe(false);
    expect(written.some((p) => p.includes('pre-commit'))).toBe(true);
  });

  it('writes the config when the repo has none', async () => {
    const { fs, writeText } = fakeFs('');
    const plan = await applyInit(ROOT, fs);
    expect(plan.refusal).toBeUndefined();
    const written = writeText.mock.calls.map((c) => (c as unknown as string[])[0]);
    expect(written.some((p) => p.includes('config.json'))).toBe(true);
  });

  it('merges into the existing .paw/.gitignore instead of replacing it', async () => {
    const { fs, writeText } = fakeFs('', 'mine\n');
    await applyInit(ROOT, fs);
    const call = writeText.mock.calls.find(
      (c) => (c as unknown as string[])[0] === ignorePathFor(ROOT),
    ) as unknown as string[];
    expect(call[1]).toMatch(/^mine\ndaemon\.token\n/);
  });

  it('writes a merged config when asked', async () => {
    const { fs, writeText } = fakeFs(EXISTING);
    const plan = await applyInit(ROOT, fs, 'merge');
    expect(plan.refusal).toBeUndefined();
    const call = writeText.mock.calls.find((c) =>
      (c as unknown as string[])[0].includes('config.json'),
    ) as unknown as string[];
    expect(JSON.parse(call[1]).runners).toEqual({ '.gate.ts': 'tsx' });
  });
});

describe('readInitPlan', () => {
  it('plans against the config and ignore file on disk and writes nothing', async () => {
    const { fs, writeText } = fakeFs(EXISTING, 'mine\n');
    const plan = await readInitPlan(ROOT, fs, 'merge');
    expect(writeText).not.toHaveBeenCalled();
    expect(plan.refusal).toBeUndefined();
    expect(plan.writes.find((w) => w.path === ignorePathFor(ROOT))?.content).toMatch(/^mine\n/);
  });

  it('reads an absent config as none', async () => {
    const { fs } = fakeFs('');
    expect((await readInitPlan(ROOT, fs, 'create')).refusal).toBeUndefined();
  });
});
