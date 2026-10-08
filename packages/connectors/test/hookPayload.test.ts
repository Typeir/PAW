/**
 * PAW Hook Payload Reader Tests
 *
 * @fileoverview Test the shared field readers: both casings, both argument
 * forms, malformed args, every path key, shell-word env detection, and the
 * quoting and separator forms a command reach a `.env` through. Cover
 * `hookPayload.ts` to 100%.
 *
 * @module @paw/connectors/test/hookPayload
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  asArgs,
  envMatch,
  extractCommands,
  extractPaths,
  sessionId,
  str,
  toolName,
} from '../src/hookPayload.js';

describe('str', () => {
  it('keeps a non-empty string and rejects everything else', () => {
    expect(str('a')).toBe('a');
    expect(str('')).toBeNull();
    expect(str(7)).toBeNull();
  });
});

describe('asArgs', () => {
  it('parses a JSON string, passes an object, and rejects the rest', () => {
    expect(asArgs('{"a":1}')).toEqual({ a: 1 });
    expect(asArgs('not json')).toBeNull();
    expect(asArgs({ a: 1 })).toEqual({ a: 1 });
    expect(asArgs(null)).toBeNull();
    expect(asArgs(7)).toBeNull();
  });
});

describe('extractPaths', () => {
  it('reads every path key across both argument casings', () => {
    expect(extractPaths({ tool_input: { file_path: 'src/a.ts' } })).toEqual(['src/a.ts']);
    expect(extractPaths({ toolInput: { filePath: 'src/b.ts' } })).toEqual(['src/b.ts']);
    expect(extractPaths({ toolInput: { path: 'src/c.ts' } })).toEqual(['src/c.ts']);
    expect(extractPaths({ toolInput: { notebook_path: 'nb.ipynb' } })).toEqual(['nb.ipynb']);
    expect(extractPaths({ toolInput: { notebookPath: 'nb2.ipynb' } })).toEqual(['nb2.ipynb']);
  });

  it('normalises backslashes and dedupes repeats across sources', () => {
    expect(
      extractPaths({ toolInput: { path: 'src\\a.ts' }, tool_input: { file_path: 'src/a.ts' } }),
    ).toEqual(['src/a.ts']);
  });

  it('reads a JSON-string argument source and ignores non-string values', () => {
    expect(extractPaths({ toolArgs: JSON.stringify({ path: 'src/d.ts' }) })).toEqual(['src/d.ts']);
    expect(extractPaths({ toolInput: { path: 7 } })).toEqual([]);
    expect(extractPaths({})).toEqual([]);
  });
});

describe('extractCommands', () => {
  it('reads command text and ignores non-string values', () => {
    expect(extractCommands({ tool_input: { command: 'ls -la' } })).toEqual(['ls -la']);
    expect(extractCommands({ toolInput: { command: 7 } })).toEqual([]);
    expect(extractCommands({})).toEqual([]);
  });
});

describe('envMatch', () => {
  it('matches an env path directly, bare or suffixed or nested', () => {
    expect(envMatch(['.env'])).toBe('.env');
    expect(envMatch(['.env.local'])).toBe('.env.local');
    expect(envMatch(['config/.env.production'])).toBe('config/.env.production');
  });

  it('matches a provider key file, by path and by shell word', () => {
    expect(envMatch(['.paw/deepseek.provider.env'])).toBe('.paw/deepseek.provider.env');
    expect(envMatch([], ['cat .paw/deepseek.provider.env'])).toBe('.paw/deepseek.provider.env');
    expect(envMatch([], ['node app.js --env-file=.env'])).toBe('--env-file=.env');
  });

  it('passes a path set that holds no env file', () => {
    expect(envMatch(['src/a.ts'])).toBeNull();
    expect(envMatch(['src/environment.ts'])).toBeNull();
    expect(envMatch([], ['source .venv/bin/activate', 'printenv PATH'])).toBeNull();
  });

  it('finds an env file named in a shell command', () => {
    expect(envMatch([], ['cat .env'])).toBe('.env');
    expect(envMatch([], ['cat ./.env.local'])).toBe('./.env.local');
    expect(envMatch([], ['grep SECRET "config/.env"'])).toBe('config/.env');
    expect(envMatch([], ["cat '.env'"])).toBe('.env');
    expect(envMatch([], ['cat a.txt;cat .env'])).toBe('.env');
    expect(envMatch([], ['cat .env.local | base64'])).toBe('.env.local');
    expect(envMatch([], ['type .env'])).toBe('.env');
    expect(envMatch([], ['cat .env > /tmp/x'])).toBe('.env');
  });

  it('normalises a windows path inside a command', () => {
    expect(envMatch([], ['type config\\.env'])).toBe('config/.env');
  });

  it('passes a command that names no env file', () => {
    expect(envMatch([], ['npm run build'])).toBeNull();
    expect(envMatch([], [''])).toBeNull();
  });

  it('prefers a direct path over a command word', () => {
    expect(envMatch(['.env.direct'], ['cat .env.shell'])).toBe('.env.direct');
  });
});

describe('sessionId and toolName', () => {
  it('read either casing and fall back', () => {
    expect(sessionId({ session_id: 's1' })).toBe('s1');
    expect(sessionId({ sessionId: 's2' })).toBe('s2');
    expect(sessionId({})).toBeNull();
    expect(toolName({ tool_name: 'Edit' })).toBe('Edit');
    expect(toolName({ toolName: 'Bash' })).toBe('Bash');
    expect(toolName({})).toBe('');
  });
});
