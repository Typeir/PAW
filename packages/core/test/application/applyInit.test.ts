/**
 * PAW Apply Init Tests
 *
 * @fileoverview Covers what `init` does when `.paw/config.json` already exists.
 * What these pin is that the use-case honours the rule — that a refusal still plans the git hook, that
 * it is reported rather than swallowed, and that `--merge` and `--override`
 * reach the planner.
 *
 * @module @paw/core/test/application/applyInit
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { stampConfig } from '../../src/domain/initConfig.js';
import { describe, expect, it, vi } from 'vitest';
import { applyInit } from '../../src/application/applyInit.js';
import type { FileSystemPort } from '../../src/ports/index.js';
import { configPathFor, planInit } from '../../src/domain/initScaffold.js';

const ROOT = '/repo';
const EXISTING = '{"surface":"all","runners":{".gate.ts":"tsx"}}';

/**
 * A filesystem fake whose `readText` serves a fixed config and which records writes.
 *
 * @param configText - What `readText` returns for any path.
 * @returns The port and its write spy.
 */
function fakeFs(configText: string) {
  const writeText = vi.fn(async () => {});
  const fs: FileSystemPort = {
    readText: async () => configText,
    writeText,
    appendText: async () => {},
    ensureDir: async () => {},
    setExecutable: async () => {},
  };
  return { fs, writeText };
}

describe('planInit with an existing config', () => {
  it('plans both files when nothing is there', () => {
    const plan = planInit(ROOT, null, 'create');
    expect(plan.writes).toHaveLength(2);
    expect(plan.refusal).toBeUndefined();
  });

  it('refuses an unstamped config but still plans the hook', () => {
    const plan = planInit(ROOT, EXISTING, 'create');
    expect(plan.refusal?.conflict.kind).toBe('unstamped');
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].path).toContain('pre-commit');
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
