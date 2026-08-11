/**
 * Secret File Permission Tests
 *
 * @fileoverview Point of module: read back permissions and verify hardening.
 * Hardening can fail silently — chmod reports success on filesystems with no
 * modes; `icacls` grant leaves an inherited entry behind. Both cases must end
 * as refusal to serve, because serving would use a CA key another account can
 * read.
 *
 * Both platform branches run here no matter platform suite on.
 *
 * @module @paw/daemon/test/secretFile
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  SECRET_DIR_MODE,
  SECRET_MODE,
  aclIsPrivate,
  aclPrincipals,
  assertPrivate,
  hardenSecret,
  hardenSecretDir,
  modeIsPrivate,
  type SecretOps,
} from '../src/infrastructure/secretFile.js';

const KEY = 'C:\\Users\\dtira\\AppData\\Local\\paw\\identity\\ca.key';

/**
 * An `icacls` listing grant given entries.
 *
 * @param {readonly string[]} entries - `PRINCIPAL:(RIGHTS)` entries.
 * @param {string} [path] - Path listing about.
 * @returns {string} Listing formatted as `icacls` print it.
 */
const listing = (entries: readonly string[], path: string = KEY): string =>
  [
    `${path} ${entries[0] ?? ''}`,
    ...entries.slice(1).map((entry) => `                 ${entry}`),
    '',
    'Successfully processed 1 files; Failed processing 0 files',
  ].join('\r\n');

/**
 * Injected effects that record what asked of them.
 *
 * @param {Partial<SecretOps>} [over] - Overrides.
 * @returns {SecretOps & { calls: string[][] }} The ops and their call log.
 */
const ops = (over: Partial<SecretOps> = {}): SecretOps & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    chmod: vi.fn(async () => undefined),
    statMode: vi.fn(async () => 0o100600),
    run: vi.fn(async (command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      return listing(['LAPTOP\\dtira:(F)']);
    }),
    user: () => 'dtira',
    ...over,
  };
};

describe('modeIsPrivate', () => {
  it('accepts owner-only modes and refuses any mode granting group or others', () => {
    expect(modeIsPrivate(0o100600)).toBe(true);
    expect(modeIsPrivate(0o040700)).toBe(true);
    expect(modeIsPrivate(0o100640)).toBe(false);
    expect(modeIsPrivate(0o100604)).toBe(false);
    expect(modeIsPrivate(0o100666)).toBe(false);
  });
});

describe('aclPrincipals', () => {
  it('reads the account off every entry, including one with a space in its name', () => {
    expect(
      aclPrincipals(listing(['NT AUTHORITY\\SYSTEM:(F)', 'BUILTIN\\Administrators:(F)']), KEY),
    ).toEqual(['NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators']);
  });

  it('strips the drive-colon from the Windows path without misreading it', () => {
    expect(aclPrincipals(listing(['LAPTOP\\dtira:(F)']), KEY)).toEqual(['LAPTOP\\dtira']);
  });

  it('ignores the summary, the blank lines, and an entry with no principal', () => {
    expect(aclPrincipals(`${KEY} :(F)\r\n\r\nSuccessfully processed 1 files`, KEY)).toEqual([]);
  });
});

describe('aclIsPrivate', () => {
  it('accepts the owning account, bare or machine-qualified, in any case', () => {
    expect(aclIsPrivate(listing(['LAPTOP\\dtira:(F)']), KEY, 'dtira')).toBe(true);
    expect(aclIsPrivate(listing(['dtira:(F)']), KEY, 'dtira')).toBe(true);
    expect(aclIsPrivate(listing(['LAPTOP\\DTIRA:(F)']), KEY, 'dtira')).toBe(true);
  });

  it('refuses a listing that still grants anyone else', () => {
    expect(aclIsPrivate(listing(['LAPTOP\\dtira:(F)', 'BUILTIN\\Users:(RX)']), KEY, 'dtira')).toBe(
      false,
    );
    expect(aclIsPrivate(listing(['NT AUTHORITY\\SYSTEM:(F)']), KEY, 'dtira')).toBe(false);
  });

  it('refuses an account whose name merely ends in the owner’s', () => {
    expect(aclIsPrivate(listing(['LAPTOP\\notdtira:(F)']), KEY, 'dtira')).toBe(false);
  });

  it('refuses a listing it could not parse', () => {
    expect(aclIsPrivate('', KEY, 'dtira')).toBe(false);
    expect(aclIsPrivate('Access is denied.', KEY, 'dtira')).toBe(false);
  });
});

describe('hardening a secret on POSIX', () => {
  it('sets owner-only mode and reads it back to confirm', async () => {
    const io = ops();
    await hardenSecret('/home/x/paw/identity/ca.key', 'linux', io);
    expect(io.chmod).toHaveBeenCalledWith('/home/x/paw/identity/ca.key', SECRET_MODE);
    expect(io.statMode).toHaveBeenCalledWith('/home/x/paw/identity/ca.key');
  });

  it('hardens the directory so keys written into it inherit the restriction', async () => {
    const io = ops({ statMode: async () => 0o040700 });
    await hardenSecretDir('/home/x/paw/identity', 'darwin', io);
    expect(io.chmod).toHaveBeenCalledWith('/home/x/paw/identity', SECRET_DIR_MODE);
  });

  it('refuses to serve when the mode did not take — a share, a umask, a mode-less filesystem', async () => {
    const io = ops({ statMode: async () => 0o100644 });
    await expect(hardenSecret('/mnt/share/ca.key', 'linux', io)).rejects.toThrow(
      'landed as mode 644',
    );
  });
});

describe('checking a secret that was not written this boot', () => {
  it('reads permissions without modifying them, on either platform', async () => {
    const posix = ops();
    await assertPrivate('/home/x/paw/identity/ca.key', 'linux', posix);
    // assertPrivate does not harden: repairing a key the daemon did not just
    // write would erase the evidence it looks for.
    expect(posix.chmod).not.toHaveBeenCalled();

    const windows = ops();
    await assertPrivate(KEY, 'win32', windows);
    expect(windows.calls).toEqual([['icacls', KEY]]);
  });

  it('refuses a key someone widened, and says it was not written this boot', async () => {
    await expect(
      assertPrivate('/home/x/ca.key', 'linux', ops({ statMode: async () => 0o100644 })),
    ).rejects.toThrow('someone changed it');

    await expect(
      assertPrivate(
        KEY,
        'win32',
        ops({ run: async () => listing(['LAPTOP\\dtira:(F)', 'BUILTIN\\Users:(RX)']) }),
      ),
    ).rejects.toThrow('someone changed it');
  });

  it('leaves the widened key exactly as it found it', async () => {
    const posix = ops({ statMode: async () => 0o100644 });
    await expect(assertPrivate('/home/x/ca.key', 'linux', posix)).rejects.toThrow();

    // Silent chmod back to 0600 make one boot where another account could read
    // key indistinguishable from every other boot.
    expect(posix.chmod).not.toHaveBeenCalled();
  });
});

describe('hardening a secret on Windows', () => {
  it('breaks inheritance, grants one account, and reads the ACL back', async () => {
    const io = ops();
    await hardenSecret(KEY, 'win32', io);
    expect(io.calls[0]).toEqual(['icacls', KEY, '/inheritance:r', '/grant:r', 'dtira:F']);
    expect(io.calls[1]).toEqual(['icacls', KEY]);
    expect(io.chmod).not.toHaveBeenCalled();
  });

  it('grants the directory an inheritable entry', async () => {
    const io = ops();
    await hardenSecretDir('C:\\paw\\identity', 'win32', {
      ...io,
      run: async (command, args) => {
        io.calls.push([command, ...args]);
        return listing(['LAPTOP\\dtira:(OI)(CI)(F)'], 'C:\\paw\\identity');
      },
    });
    expect(io.calls[0]).toEqual([
      'icacls',
      'C:\\paw\\identity',
      '/inheritance:r',
      '/grant:r',
      'dtira:(OI)(CI)F',
    ]);
  });

  it('refuses to serve when an entry remains after the grant', async () => {
    const io = ops({
      run: async () => listing(['LAPTOP\\dtira:(F)', 'BUILTIN\\Administrators:(I)(F)']),
    });
    await expect(hardenSecret(KEY, 'win32', io)).rejects.toThrow(`not restricted to dtira`);
  });

  it('names the offending listing in the error, so the operator can see who has it', async () => {
    const io = ops({ run: async () => listing(['Everyone:(F)']) });
    await expect(hardenSecret(KEY, 'win32', io)).rejects.toThrow(/Everyone/);
  });
});
