/**
 * PAW Installer Apply Tests
 *
 * @fileoverview Cover app layer with fake ports. PATH activation on Windows
 * persist, and no-op when present. POSIX appends, no-op when present — so
 * `apply.ts` hit 100%. Repository move to `@paw/core`; its tests go too.
 *
 * @module @paw/installer/test/apply
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it, vi } from 'vitest';
import { activatePath } from '../src/apply.js';
import { MARK_BEGIN } from '../src/path.js';
import type { EnvironmentPort, FileSystemPort } from '../src/ports.js';

/**
 * Filesystem fake. Record writes/appends, serve fixed profile text.
 *
 * @param profileText - What `readText` give back.
 */
function fakeFs(profileText = '') {
  const appendText = vi.fn(async () => {});
  const writeText = vi.fn(async () => {});
  const ensureDir = vi.fn(async () => {});
  const setExecutable = vi.fn(async () => {});
  const fs: FileSystemPort = {
    readText: async () => profileText,
    writeText,
    appendText,
    ensureDir,
    setExecutable,
  };
  return { fs, appendText, writeText, ensureDir, setExecutable };
}

/**
 * Environment fake. Serve fixed user Path, record writes.
 *
 * @param current - The current user Path.
 */
function fakeEnv(current: string) {
  const setUserPath = vi.fn(async () => {});
  const env: EnvironmentPort = { getUserPath: async () => current, setUserPath };
  return { env, setUserPath };
}

const home = '/home/x';
const binDir = '/home/x/.paw/bin';

describe('activatePath (windows)', () => {
  it('persists a prepended user Path when absent', async () => {
    const { fs } = fakeFs();
    const { env, setUserPath } = fakeEnv('C:\\Windows');
    const edit = await activatePath({ platform: 'win32', shellEnv: undefined, home, binDir }, fs, env);
    expect(edit.kind).toBe('windows-registry');
    expect(setUserPath).toHaveBeenCalledWith('\\home\\x\\.paw\\bin;C:\\Windows');
  });

  it('does nothing when the bin dir is already on the user Path', async () => {
    const { fs } = fakeFs();
    const { env, setUserPath } = fakeEnv(`${binDir};C:\\Windows`);
    const edit = await activatePath({ platform: 'win32', shellEnv: undefined, home, binDir }, fs, env);
    expect(edit.kind).toBe('already-present');
    expect(setUserPath).not.toHaveBeenCalled();
  });

  it('computes but never writes under dryRun', async () => {
    const { fs } = fakeFs();
    const { env, setUserPath } = fakeEnv('C:\\Windows');
    const edit = await activatePath({ platform: 'win32', shellEnv: undefined, home, binDir, dryRun: true }, fs, env);
    expect(edit.kind).toBe('windows-registry');
    expect(setUserPath).not.toHaveBeenCalled();
  });
});

describe('activatePath (posix)', () => {
  it('appends the marker block when absent', async () => {
    const { fs, appendText } = fakeFs('# empty profile\n');
    const { env } = fakeEnv('');
    const edit = await activatePath({ platform: 'linux', shellEnv: '/bin/zsh', home, binDir }, fs, env);
    expect(edit.kind).toBe('profile-append');
    expect(appendText).toHaveBeenCalledWith('/home/x/.zshrc', edit.block);
  });

  it('does nothing when the marker block is already present', async () => {
    const { fs, appendText } = fakeFs(`prior\n${MARK_BEGIN}\n...\n`);
    const { env } = fakeEnv('');
    const edit = await activatePath({ platform: 'linux', shellEnv: '/bin/bash', home, binDir }, fs, env);
    expect(edit.kind).toBe('already-present');
    expect(appendText).not.toHaveBeenCalled();
  });
});
