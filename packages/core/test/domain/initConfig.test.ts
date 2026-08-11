/**
 * PAW Init Config Tests
 *
 * @fileoverview Pin rule. Attach PAW to repo, never replace existing config.
 * Return conflict as data. Every surface (CLI, TUI, console) resolve from same call.
 *
 * @module @paw/core/test/domain/initConfig
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  PAW_CONFIG_VERSION,
  PAW_STAMP_KEY,
  inspectConfig,
  mergeConfig,
  resolveInit,
  stampConfig,
} from '../../src/domain/initConfig.js';

const FRESH = { root: '.paw', gatesDir: '.paw/gates', connector: 'copilot-hooks' };

describe('stampConfig', () => {
  it('records the version and a hash of what it wrote', () => {
    const parsed = JSON.parse(stampConfig(FRESH)) as Record<string, unknown>;
    const stamp = parsed[PAW_STAMP_KEY] as { version: string; hash: string };
    expect(stamp.version).toBe(PAW_CONFIG_VERSION);
    expect(stamp.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('keeps every declared key alongside the stamp', () => {
    const parsed = JSON.parse(stampConfig(FRESH)) as Record<string, unknown>;
    expect(parsed.root).toBe('.paw');
    expect(parsed.connector).toBe('copilot-hooks');
  });

  it('hashes by content, not key order', () => {
    const a = JSON.parse(stampConfig({ a: 1, b: 2 })) as Record<string, never>;
    const b = JSON.parse(stampConfig({ b: 2, a: 1 })) as Record<string, never>;
    expect(a[PAW_STAMP_KEY]).toEqual(b[PAW_STAMP_KEY]);
  });

  it('ends with a newline so the file is well formed', () => {
    expect(stampConfig(FRESH).endsWith('\n')).toBe(true);
  });
});

describe('inspectConfig', () => {
  it('reports absent when there is no config at all', () => {
    expect(inspectConfig(null)).toEqual({ kind: 'absent' });
    expect(inspectConfig('   ')).toEqual({ kind: 'absent' });
  });

  it('reports unstamped for a config PAW did not write', () => {
    expect(inspectConfig('{"surface":"all","runners":{}}')).toEqual({
      kind: 'unstamped',
    });
  });

  it('reports stamped and unedited for its own untouched output', () => {
    const found = inspectConfig(stampConfig(FRESH));
    expect(found.kind).toBe('stamped');
    if (found.kind !== 'stamped') return;
    expect(found.stamp.version).toBe(PAW_CONFIG_VERSION);
    expect(found.edited).toBe(false);
  });

  it('detects an edit to a config it stamped', () => {
    const parsed = JSON.parse(stampConfig(FRESH)) as Record<string, unknown>;
    parsed.connector = 'something-else';
    const found = inspectConfig(JSON.stringify(parsed));
    expect(found.kind).toBe('stamped');
    if (found.kind !== 'stamped') return;
    expect(found.edited).toBe(true);
  });

  it('reads a hand-edited or unexpected-shape stamp as unstamped and refuses it', () => {
    expect(inspectConfig('{"$paw":null}').kind).toBe('unstamped');
    expect(inspectConfig('{"$paw":"5.0.0"}').kind).toBe('unstamped');
    expect(inspectConfig('{"$paw":{}}').kind).toBe('unstamped');
    expect(inspectConfig('{"$paw":{"version":1,"hash":"abc"}}').kind).toBe('unstamped');
    expect(inspectConfig('{"$paw":{"version":"5.0.0"}}').kind).toBe('unstamped');
  });

  it('throws on a config that is not JSON rather than reporting it as absent', () => {
    expect(() => inspectConfig('{broken')).toThrow(/not valid JSON/i);
  });

  it('throws when the config is not an object', () => {
    expect(() => inspectConfig('[]')).toThrow(/object/i);
  });
});

describe('mergeConfig', () => {
  it('adds keys PAW needs without touching keys the operator set', () => {
    const merged = mergeConfig({ runners: { '.gate.ts': 'tsx' }, root: 'custom' }, FRESH);
    expect(merged.runners).toEqual({ '.gate.ts': 'tsx' });
    expect(merged.root).toBe('custom');
    expect(merged.connector).toBe('copilot-hooks');
  });

  it('never drops an existing key', () => {
    const merged = mergeConfig({ surface: 'all', domains: ['a'] }, FRESH);
    expect(merged.surface).toBe('all');
    expect(merged.domains).toEqual(['a']);
  });

  it('drops a stale stamp so the result can be restamped', () => {
    const existing = JSON.parse(stampConfig({ root: 'custom' })) as Record<string, unknown>;
    expect(mergeConfig(existing, FRESH)[PAW_STAMP_KEY]).toBeUndefined();
  });
});

describe('resolveInit', () => {
  it('writes when nothing is there', () => {
    const out = resolveInit(null, FRESH, 'create');
    expect(out.kind).toBe('write');
  });

  it('refuses an existing config unless told what to do', () => {
    const out = resolveInit(stampConfig(FRESH), FRESH, 'create');
    expect(out.kind).toBe('refuse');
    if (out.kind !== 'refuse') return;
    expect(out.conflict.kind).toBe('stamped');
    expect(out.reason).toMatch(/--merge|--override/);
  });

  it('says so when refusing a config PAW wrote and someone has since edited', () => {
    const parsed = JSON.parse(stampConfig(FRESH)) as Record<string, unknown>;
    parsed.connector = 'changed-by-hand';
    const out = resolveInit(JSON.stringify(parsed), FRESH, 'create');
    expect(out.kind).toBe('refuse');
    if (out.kind !== 'refuse') return;
    expect(out.reason).toContain('edited since');
  });

  it('refuses an unstamped config too, naming it as not PAW’s', () => {
    const out = resolveInit('{"surface":"all"}', FRESH, 'create');
    expect(out.kind).toBe('refuse');
    if (out.kind !== 'refuse') return;
    expect(out.conflict.kind).toBe('unstamped');
  });

  it('merges when asked, preserving operator keys', () => {
    const out = resolveInit('{"runners":{".gate.ts":"tsx"}}', FRESH, 'merge');
    expect(out.kind).toBe('write');
    if (out.kind !== 'write') return;
    const parsed = JSON.parse(out.content) as Record<string, unknown>;
    expect(parsed.runners).toEqual({ '.gate.ts': 'tsx' });
    expect(parsed.connector).toBe('copilot-hooks');
    expect(parsed[PAW_STAMP_KEY]).toBeDefined();
  });

  it('overrides when asked, discarding everything', () => {
    const out = resolveInit('{"runners":{".gate.ts":"tsx"}}', FRESH, 'override');
    expect(out.kind).toBe('write');
    if (out.kind !== 'write') return;
    const parsed = JSON.parse(out.content) as Record<string, unknown>;
    expect(parsed.runners).toBeUndefined();
    expect(parsed.connector).toBe('copilot-hooks');
  });

  it('merge and override both work when nothing exists yet', () => {
    expect(resolveInit(null, FRESH, 'merge').kind).toBe('write');
    expect(resolveInit(null, FRESH, 'override').kind).toBe('write');
  });
});
