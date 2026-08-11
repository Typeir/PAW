/**
 * PAW Installer Shell Tests
 *
 * @fileoverview Cover `detectShell` (Windows override, no `$SHELL`, zsh/bash/fish,
 * and unrecognised shell) and `profileTarget` (every shell arm), so `shell.ts`
 * reach 100%.
 *
 * @module @paw/installer/test/shell
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { detectShell, profileTarget, WINDOWS_ENV } from '../src/shell.js';

describe('detectShell', () => {
  it('resolves Windows to powershell regardless of $SHELL', () => {
    expect(detectShell('win32', undefined)).toBe('powershell');
    expect(detectShell('win32', '/usr/bin/bash')).toBe('powershell');
  });

  it('is unknown when $SHELL is unset on POSIX', () => {
    expect(detectShell('linux', undefined)).toBe('unknown');
  });

  it('detects zsh, bash, and fish from $SHELL', () => {
    expect(detectShell('linux', '/usr/bin/zsh')).toBe('zsh');
    expect(detectShell('darwin', '/bin/bash')).toBe('bash');
    expect(detectShell('linux', '/usr/local/bin/fish')).toBe('fish');
  });

  it('is unknown for an unrecognised shell', () => {
    expect(detectShell('linux', '/bin/dash')).toBe('unknown');
  });
});

describe('profileTarget', () => {
  it('maps each shell to its profile or the Windows env store', () => {
    expect(profileTarget('powershell', '/home/x')).toBe(WINDOWS_ENV);
    expect(profileTarget('zsh', '/home/x')).toBe('/home/x/.zshrc');
    expect(profileTarget('bash', '/home/x')).toBe('/home/x/.bashrc');
    expect(profileTarget('fish', '/home/x')).toBe('/home/x/.config/fish/config.fish');
    expect(profileTarget('unknown', '/home/x')).toBe('/home/x/.profile');
  });
});
