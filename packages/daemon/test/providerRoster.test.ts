/**
 * Provider Roster Tests
 *
 * @fileoverview Cover the key-free roster over a real temp filesystem: parsed
 * providers carry identity and credential length only, broken env files stay
 * on the roster with their reason, foreign files are ignored, and a missing
 * `.paw` directory is an empty roster. The credential string itself must
 * never appear in any entry.
 *
 * @module @paw/daemon/test/providerRoster
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listProviders } from '../src/infrastructure/model/providerRoster.js';

const dirs: string[] = [];
const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'paw-roster-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.paw'), { recursive: true });
  return dir;
};

afterAll(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('listProviders', () => {
  it('lists parsed providers key-free, sorted, ignoring foreign files', () => {
    const root = repo();
    writeFileSync(
      join(root, '.paw', 'deepseek.provider.env'),
      'KEY=sk-secret-material\nBASE_URL=https://api.deepseek.com/v1\nMODEL=deepseek-chat\n',
      'utf8',
    );
    writeFileSync(
      join(root, '.paw', 'azure-lab.provider.env'),
      'KEY=abcd\nBASE_URL=https://lab.azure.example\nTYPE=azure\n',
      'utf8',
    );
    writeFileSync(join(root, '.paw', 'config.json'), '{}', 'utf8');

    const roster = listProviders(root);
    expect(roster).toEqual([
      { name: 'azure-lab', type: 'azure', baseUrl: 'https://lab.azure.example', keyChars: 4 },
      {
        name: 'deepseek',
        type: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        keyChars: 18,
      },
    ]);
    expect(JSON.stringify(roster)).not.toContain('sk-secret-material');
  });

  it('keeps a broken env file on the roster with its reason', () => {
    const root = repo();
    writeFileSync(join(root, '.paw', 'half.provider.env'), 'KEY=only-a-key\n', 'utf8');
    expect(listProviders(root)).toEqual([
      { name: 'half', error: 'provider "half": half.provider.env needs KEY and BASE_URL' },
    ]);
  });

  it('answers empty for a repo without .paw', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paw-bare-'));
    dirs.push(bare);
    expect(listProviders(bare)).toEqual([]);
  });

  it('reads through injected seams', () => {
    const roster = listProviders('/repo', {
      readDir: () => ['x.provider.env'],
      readFile: () => 'KEY=k\nBASE_URL=https://x\n',
    });
    expect(roster).toEqual([{ name: 'x', type: 'openai', baseUrl: 'https://x', keyChars: 1 }]);
  });
});
