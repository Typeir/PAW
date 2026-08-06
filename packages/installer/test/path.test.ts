/**
 * PAW Installer PATH Planner Tests
 *
 * @fileoverview Covers `planPathEdit` on every arm — Windows absent (prepend) and
 * present (no-op), POSIX append (bash export) and already-present (marker), and the
 * fish line — so `path.ts` reaches 100%.
 *
 * @module @paw/installer/test/path
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { MARK_BEGIN, planPathEdit } from '../src/path.js';

const base = { home: '/home/x', binDir: '/home/x/.paw/bin', currentPath: '', profileText: '' };

describe('planPathEdit', () => {
  it('prepends the bin dir to the Windows user Path when absent', () => {
    const edit = planPathEdit({ ...base, shell: 'powershell', currentPath: 'C:\\Windows;C:\\Tools' });
    expect(edit.kind).toBe('windows-registry');
    expect(edit.newPath).toBe('/home/x/.paw/bin;C:\\Windows;C:\\Tools');
  });

  it('is a no-op when the bin dir is already on the Windows Path', () => {
    const edit = planPathEdit({ ...base, shell: 'powershell', currentPath: `${base.binDir};C:\\Windows` });
    expect(edit.kind).toBe('already-present');
    expect(edit.newPath).toBeUndefined();
  });

  it('appends a marker block with an export line for bash/zsh', () => {
    const edit = planPathEdit({ ...base, shell: 'zsh' });
    expect(edit.kind).toBe('profile-append');
    expect(edit.target).toBe('/home/x/.zshrc');
    expect(edit.block).toBe(`${MARK_BEGIN}\nexport PATH="/home/x/.paw/bin:$PATH"\n# <<< paw <<<\n`);
  });

  it('uses fish_add_path for fish', () => {
    const edit = planPathEdit({ ...base, shell: 'fish' });
    expect(edit.block).toContain('fish_add_path /home/x/.paw/bin');
  });

  it('is a no-op when the marker block is already present', () => {
    const edit = planPathEdit({ ...base, shell: 'bash', profileText: `existing\n${MARK_BEGIN}\n...\n` });
    expect(edit.kind).toBe('already-present');
    expect(edit.block).toBeUndefined();
  });
});
