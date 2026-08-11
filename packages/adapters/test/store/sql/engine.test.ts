/**
 * PAW store engine resolution test.
 *
 * @fileoverview Prove engine choice resolve from explicit override first, machine-level config second. Unknown value fail loud.
 *
 * @module @paw/adapters/test/store/sql/engine
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORE_ENGINE,
  resolveStoreEngine,
  serialiseEngineChoice,
} from '../../../src/store/sql/engine.js';

describe('resolveStoreEngine', () => {
  it('defaults to the native engine when nothing is configured', () => {
    expect(resolveStoreEngine({}, null)).toBe(DEFAULT_STORE_ENGINE);
    expect(DEFAULT_STORE_ENGINE).toBe('sqlite');
  });

  it('reads the engine from machine config', () => {
    expect(resolveStoreEngine({}, '{"db":"wasm"}')).toBe('wasm');
    expect(resolveStoreEngine({}, '{"db":"sqlite"}')).toBe('sqlite');
  });

  it('lets an explicit env override beat the config file', () => {
    expect(resolveStoreEngine({ PAW_DB_ENGINE: 'wasm' }, '{"db":"sqlite"}')).toBe(
      'wasm',
    );
  });

  it('ignores an empty env override', () => {
    expect(resolveStoreEngine({ PAW_DB_ENGINE: '' }, '{"db":"wasm"}')).toBe(
      'wasm',
    );
  });

  it('defaults when the config omits the key', () => {
    expect(resolveStoreEngine({}, '{"other":1}')).toBe(DEFAULT_STORE_ENGINE);
  });

  it('treats a blank config file as absent', () => {
    expect(resolveStoreEngine({}, '   ')).toBe(DEFAULT_STORE_ENGINE);
  });

  it('rejects a JSON array as config', () => {
    expect(() => resolveStoreEngine({}, '[]')).toThrow(/object/i);
  });

  it('throws on an unrecognised env engine, naming the valid choices', () => {
    expect(() => resolveStoreEngine({ PAW_DB_ENGINE: 'postgres' }, null)).toThrow(
      /PAW_DB_ENGINE.*postgres.*sqlite.*wasm/s,
    );
  });

  it('throws on an unrecognised config engine', () => {
    expect(() => resolveStoreEngine({}, '{"db":"mysql"}')).toThrow(
      /mysql.*sqlite.*wasm/s,
    );
  });

  it('throws on malformed config rather than silently defaulting', () => {
    expect(() => resolveStoreEngine({}, '{not json')).toThrow(/config/i);
  });

  it('throws when config is not a JSON object', () => {
    expect(() => resolveStoreEngine({}, '"a string"')).toThrow(/object/i);
  });
});

describe('serialiseEngineChoice', () => {
  it('writes the choice into empty config', () => {
    expect(JSON.parse(serialiseEngineChoice('wasm', null))).toEqual({
      db: 'wasm',
    });
  });

  it('preserves unrelated keys already in the config', () => {
    const out = JSON.parse(
      serialiseEngineChoice('sqlite', '{"db":"wasm","telemetry":false}'),
    ) as Record<string, unknown>;
    expect(out).toEqual({ db: 'sqlite', telemetry: false });
  });

  it('throws rather than clobbering a malformed config file', () => {
    expect(() => serialiseEngineChoice('sqlite', '{broken')).toThrow(/config/i);
  });
});
