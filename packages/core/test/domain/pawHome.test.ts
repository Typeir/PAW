/**
 * PAW Home Tests
 *
 * @fileoverview Pins the per-platform rules from any platform, since the
 * resolver is pure over an injected environment. Moved here with `pawHome`
 * itself when the installer needed it and could not be made to depend on the
 * daemon to get it.
 *
 * @module @paw/core/test/domain/pawHome
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { binDir, pawHome } from '../../src/domain/pawHome.js';

describe('pawHome', () => {
  it('honours an explicit override above all', () => {
    expect(pawHome('linux', { PAW_HOME: '/tmp/paw-home' })).toBe('/tmp/paw-home');
    expect(
      pawHome('win32', {
        PAW_HOME: 'C:\\paw\\',
        LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
      }),
    ).toBe('C:/paw');
  });

  it('follows each platform’s convention', () => {
    expect(pawHome('win32', { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' })).toBe(
      'C:/Users/x/AppData/Local/paw',
    );
    expect(pawHome('darwin', { HOME: '/Users/x' })).toBe(
      '/Users/x/Library/Application Support/paw',
    );
    expect(pawHome('linux', { XDG_DATA_HOME: '/home/x/.data' })).toBe(
      '/home/x/.data/paw',
    );
    expect(pawHome('linux', { HOME: '/home/x' })).toBe('/home/x/.local/share/paw');
  });

  it('falls back to the Windows profile when LOCALAPPDATA is missing', () => {
    expect(pawHome('win32', { USERPROFILE: 'C:\\Users\\x' })).toBe('C:/Users/x/paw');
  });

  it('fails loud rather than writing keys somewhere arbitrary', () => {
    expect(() => pawHome('win32', {})).toThrow('neither LOCALAPPDATA nor USERPROFILE');
    expect(() => pawHome('darwin', {})).toThrow('HOME is not set');
    expect(() => pawHome('linux', {})).toThrow('neither XDG_DATA_HOME nor HOME');
    expect(() => pawHome('linux', { PAW_HOME: '' })).toThrow();
  });
});

describe('binDir', () => {
  it('puts the binary under the machine home, not a repository', () => {
    expect(binDir('/home/x/.local/share/paw')).toBe('/home/x/.local/share/paw/bin');
    expect(binDir('C:/Users/x/AppData/Local/paw')).toBe(
      'C:/Users/x/AppData/Local/paw/bin',
    );
  });

  it('is the directory paw-setup puts on PATH for every platform', () => {
    for (const [platform, env] of [
      ['win32', { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }],
      ['darwin', { HOME: '/Users/x' }],
      ['linux', { HOME: '/home/x' }],
    ] as const) {
      expect(binDir(pawHome(platform, env)).endsWith('/paw/bin')).toBe(true);
    }
  });
});
