/**
 * Console Launcher Tests
 *
 * @fileoverview Cover the desktop-first open decision: shell paths resolve to
 * the sibling electron package, missing bundle or binary falls straight back
 * to the browser, a spawn that errors or exits inside the grace window falls
 * back exactly once, and a shell that outlives the grace window is detached
 * and wins.
 *
 * @module @paw/cli/test/unit/electronLauncher
 */

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ELECTRON_GRACE_MS,
  openConsole,
  shellPathsFor,
  type ChildLike,
  type LauncherSeams,
} from '../../src/application/electronLauncher.js';

/**
 * A child the test fires by hand.
 *
 * @returns {{ child: ChildLike; fire(event: 'error' | 'exit'): void; unrefs(): number }} Child and controls.
 */
const scriptedChild = (): {
  child: ChildLike;
  fire(event: 'error' | 'exit'): void;
  unrefs(): number;
} => {
  const listeners = new Map<string, () => void>();
  let unrefCount = 0;
  return {
    child: {
      once: (event, listener) => {
        listeners.set(event, listener);
      },
      unref: () => {
        unrefCount += 1;
      },
    },
    fire: (event) => listeners.get(event)?.(),
    unrefs: () => unrefCount,
  };
};

const seamsWith = (over: Partial<LauncherSeams>): LauncherSeams & { opened: string[] } => {
  const opened: string[] = [];
  return {
    exists: () => true,
    electronBinOf: () => '/fake/electron.exe',
    spawnShell: () => scriptedChild().child,
    openWeb: (url) => {
      opened.push(url);
    },
    graceMs: 5,
    opened,
    ...over,
  };
};

const URL = 'https://127.0.0.1:8971/#t=secret';
const FP = 'aa:bb:cc';

describe('shellPathsFor', () => {
  it('points at the sibling electron package and its bundle', () => {
    const { dir, main } = shellPathsFor(join('repo', 'packages', 'cli'));
    expect(dir).toBe(join('repo', 'packages', 'electron'));
    expect(main).toBe(join('repo', 'packages', 'electron', 'dist', 'main.cjs'));
  });
});

describe('openConsole', () => {
  it('opens the browser when the shell bundle is not built', async () => {
    const seams = seamsWith({ exists: () => false, electronBinOf: vi.fn(() => null) });
    expect(await openConsole(URL, FP, 'cli', seams)).toBe('web');
    expect(seams.opened).toEqual([URL]);
    expect(seams.electronBinOf).not.toHaveBeenCalled();
  });

  it('opens the browser when the electron binary is not installed or not on disk', async () => {
    expect(await openConsole(URL, FP, 'cli', seamsWith({ electronBinOf: () => null }))).toBe('web');
    const missingBin = seamsWith({
      exists: (path) => !path.endsWith('.exe'),
      electronBinOf: () => '/fake/electron.exe',
    });
    expect(await openConsole(URL, FP, 'cli', missingBin)).toBe('web');
  });

  it('hands the shell the bundle, the url, and the fingerprint to pin', async () => {
    const spawnShell = vi.fn(() => scriptedChild().child);
    await openConsole(URL, FP, join('repo', 'packages', 'cli'), seamsWith({ spawnShell }));
    expect(spawnShell).toHaveBeenCalledWith('/fake/electron.exe', [
      join('repo', 'packages', 'electron', 'dist', 'main.cjs'),
      `--url=${URL}`,
      `--fingerprint=${FP}`,
    ]);
  });

  it('falls back to the browser when the spawn errors', async () => {
    const scripted = scriptedChild();
    const seams = seamsWith({ spawnShell: () => scripted.child, graceMs: 1000 });
    const surface = openConsole(URL, FP, 'cli', seams);
    scripted.fire('error');
    expect(await surface).toBe('web');
    expect(seams.opened).toEqual([URL]);
  });

  it('falls back to the browser when the shell exits inside the grace window, once only', async () => {
    const scripted = scriptedChild();
    const seams = seamsWith({ spawnShell: () => scripted.child, graceMs: 1000 });
    const surface = openConsole(URL, FP, 'cli', seams);
    scripted.fire('exit');
    scripted.fire('error');
    expect(await surface).toBe('web');
    expect(seams.opened).toEqual([URL]);
  });

  it('detaches and reports the shell when it outlives the grace window', async () => {
    const scripted = scriptedChild();
    const seams = seamsWith({ spawnShell: () => scripted.child, graceMs: 5 });
    expect(await openConsole(URL, FP, 'cli', seams)).toBe('electron');
    expect(scripted.unrefs()).toBe(1);
    expect(seams.opened).toEqual([]);
    scripted.fire('exit');
    expect(seams.opened).toEqual([]);
  });

  describe('with the default grace window', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('waits ELECTRON_GRACE_MS before declaring the shell up', async () => {
      const scripted = scriptedChild();
      const surface = openConsole(
        URL,
        FP,
        'cli',
        seamsWith({ spawnShell: () => scripted.child, graceMs: undefined }),
      );
      await vi.advanceTimersByTimeAsync(ELECTRON_GRACE_MS - 1);
      scripted.fire('exit');
      await vi.advanceTimersByTimeAsync(2);
      expect(await surface).toBe('web');
    });
  });
});
