/**
 * PAW Environment File Tests
 *
 * @fileoverview Cover which paths count as environment files: dotenv names,
 * provider key files, both slash styles, and names that only look similar.
 *
 * @module @paw/core/test/domain/envFile
 */

import { describe, expect, it } from 'vitest';
import { isEnvFile } from '../../src/domain/envFile.js';

describe('isEnvFile', () => {
  it.each([
    '.env',
    '.env.local',
    'config/.env.production',
    '.envrc',
    '.env_backup',
    '.paw/deepseek.provider.env',
    'C:/repo/.paw/rally.provider.env',
    'C:\\repo\\.paw\\rally.provider.env',
    'prod.env',
    '--env-file=.env',
  ])('treats %s as an environment file', (path) => {
    expect(isEnvFile(path)).toBe(true);
  });

  it.each([
    'src/a.ts',
    'src/environment.ts',
    '.venv',
    '.venv/bin/activate',
    'node_modules/dotenv',
    'printenv',
    'env',
    '.env/',
    '',
  ])('passes %s', (path) => {
    expect(isEnvFile(path)).toBe(false);
  });
});
