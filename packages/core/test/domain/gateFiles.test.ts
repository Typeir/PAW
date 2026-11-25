/**
 * Gate file discovery tests
 *
 * @fileoverview Cover `GATE_FILE` and `countGateFiles`: direct children of the
 * gates directory only, every loadable extension, `./` and trailing `/` in the
 * configured directory ignored.
 *
 * @module @paw/core/test/domain/gateFiles
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { GATE_FILE, countGateFiles } from '../../src/index.js';

describe('GATE_FILE', () => {
  it('accepts every import-loadable gate module and nothing else', () => {
    for (const ext of ['mts', 'cts', 'ts', 'mjs', 'cjs', 'js']) {
      expect(GATE_FILE.test(`no-bad.gate.${ext}`)).toBe(true);
    }
    expect(GATE_FILE.test('no-bad.gate.json')).toBe(false);
    expect(GATE_FILE.test('gate.mjs')).toBe(false);
  });
});

describe('countGateFiles', () => {
  const paths = [
    '.paw/gates/no-console.gate.mjs',
    '.paw/gates/no-secrets.gate.ts',
    '.paw/gates/README.md',
    '.paw/gates/nested/deep.gate.mjs',
    'src/fake.gate.mjs',
    'top.gate.mjs',
  ];

  it('counts gate modules directly inside the gates directory', () => {
    expect(countGateFiles(paths, '.paw/gates')).toBe(2);
  });

  it('ignores a leading ./ and trailing slashes in the configured directory', () => {
    expect(countGateFiles(paths, './.paw/gates/')).toBe(2);
  });

  it('counts root-level gate files when the directory is the root', () => {
    expect(countGateFiles(paths, './')).toBe(1);
  });

  it('is zero for a directory holding no gates', () => {
    expect(countGateFiles(paths, 'docs')).toBe(0);
  });
});
