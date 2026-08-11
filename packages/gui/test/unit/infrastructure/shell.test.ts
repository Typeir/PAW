/**
 * Shell detection tests.
 *
 * @fileoverview Tell what shell console live in. Bridge count only when every
 * window control it claim actually callable, so window chrome never draw over
 * dead button.
 *
 * @module @paw/gui/test/unit/infrastructure/shell
 */

import { describe, expect, it, vi } from 'vitest';
import { detectShell, windowControls, type ShellWindow } from '../../../src/infrastructure/shell.js';

describe('detectShell / windowControls', () => {
  it('is a web page when nothing injected a bridge', () => {
    expect(detectShell({})).toBe('web');
    expect(windowControls({})).toBeNull();
  });

  it('is a desktop shell when the bridge can drive a window', () => {
    const win: ShellWindow = {
      paw: { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() },
    };
    expect(detectShell(win)).toBe('desktop');
    expect(windowControls(win)).not.toBeNull();
  });

  it('drives the window through the bridge', () => {
    const bridge = { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() };
    const controls = windowControls({ paw: bridge });
    controls?.minimize();
    controls?.maximize();
    controls?.close();
    expect(bridge.minimize).toHaveBeenCalledOnce();
    expect(bridge.maximize).toHaveBeenCalledOnce();
    expect(bridge.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['no controls at all', { version: '33.0.0', platform: 'win32' }],
    ['no maximize', { minimize: vi.fn(), close: vi.fn() }],
    ['no close', { minimize: vi.fn(), maximize: vi.fn() }],
  ])('is a web page when the bridge has %s', (_label, paw) => {
    expect(detectShell({ paw })).toBe('web');
    expect(windowControls({ paw })).toBeNull();
  });
});
