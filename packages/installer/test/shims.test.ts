/**
 * PAW Installer Shim Planner Tests
 *
 * @fileoverview Cover `planShims` on both platforms: Windows plan the sh + cmd + ps1
 * trio per launcher (backslashed entry inside cmd/ps1, forward in sh, executable
 * bit on sh alone); POSIX plan the sh shim only. Also cover `installShims`: dir
 * ensured, every shim written, executable bit set where planned, and dry-run
 * write nothing.
 *
 * @module @paw/installer/test/shims
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it, vi } from 'vitest';
import { installShims } from '../src/apply.js';
import { planShims } from '../src/shims.js';
import type { FileSystemPort } from '../src/ports.js';

const LAUNCHERS = [{ name: 'paw', entry: 'C:/repo/bin/paw.mjs' }];

function fakeFs() {
  const writeText = vi.fn(async () => {});
  const ensureDir = vi.fn(async () => {});
  const setExecutable = vi.fn(async () => {});
  const fs: FileSystemPort = {
    readText: async () => '',
    writeText,
    appendText: async () => {},
    ensureDir,
    setExecutable,
  };
  return { fs, writeText, ensureDir, setExecutable };
}

describe('planShims', () => {
  it('plans the sh, cmd, and ps1 trio on Windows', () => {
    const writes = planShims('win32', 'C:/bin', LAUNCHERS);
    expect(writes.map((w) => w.path)).toEqual(['C:/bin/paw', 'C:/bin/paw.cmd', 'C:/bin/paw.ps1']);
    expect(writes[0].content).toBe('#!/bin/sh\nexec node "C:/repo/bin/paw.mjs" "$@"\n');
    expect(writes[0].executable).toBe(true);
    expect(writes[1].content).toContain('node "C:\\repo\\bin\\paw.mjs" %*');
    expect(writes[1].executable).toBe(false);
    expect(writes[2].content).toContain('& node "C:\\repo\\bin\\paw.mjs" @args');
    expect(writes[2].executable).toBe(false);
  });

  it('plans only the executable sh shim on POSIX, forward-slashing the entry', () => {
    const writes = planShims('linux', '/home/x/bin', [{ name: 'paw', entry: '\\repo\\bin\\paw.mjs' }]);
    expect(writes).toEqual([
      {
        path: '/home/x/bin/paw',
        content: '#!/bin/sh\nexec node "/repo/bin/paw.mjs" "$@"\n',
        executable: true,
      },
    ]);
  });
});

describe('installShims', () => {
  it('ensures the dir, writes every shim, and sets the bit on sh only', async () => {
    const { fs, writeText, ensureDir, setExecutable } = fakeFs();
    const writes = await installShims(
      { platform: 'win32', binDir: 'C:/bin', launchers: LAUNCHERS },
      fs,
    );
    expect(ensureDir).toHaveBeenCalledWith('C:/bin');
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(setExecutable).toHaveBeenCalledTimes(1);
    expect(setExecutable).toHaveBeenCalledWith('C:/bin/paw');
    expect(writes).toHaveLength(3);
  });

  it('writes nothing under dry-run but still returns the plan', async () => {
    const { fs, writeText, ensureDir, setExecutable } = fakeFs();
    const writes = await installShims(
      { platform: 'linux', binDir: '/b', launchers: LAUNCHERS, dryRun: true },
      fs,
    );
    expect(writes).toHaveLength(1);
    expect(ensureDir).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(setExecutable).not.toHaveBeenCalled();
  });
});
