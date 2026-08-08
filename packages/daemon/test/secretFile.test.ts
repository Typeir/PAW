/**
 * Secret File Permission Tests
 *
 * @fileoverview The read-back is the point of this module, so the tests are
 * mostly about the case where hardening *fails silently* — a chmod that reported
 * success onto a filesystem that does not carry modes, an `icacls` grant that
 * left an inherited entry behind. Both must end as a refusal to serve, because
 * continuing means running with a CA key that another account can read.
 *
 * Both platform branches run here regardless of the platform this suite is on.
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
 * An `icacls` listing granting the given entries.
 *
 * @param {readonly string[]} entries - The `PRINCIPAL:(RIGHTS)` entries.
 * @param {string} [path] - The path the listing is about.
 * @returns {string} The listing, formatted as `icacls` prints it.
 */
const listing = (entries: readonly string[], path: string = KEY): string =>
  [
    `${path} ${entries[0] ?? ''}`,
    ...entries.slice(1).map((entry) => `                 ${entry}`),
    '',
    'Successfully processed 1 files; Failed processing 0 files',
  ].join('\r\n');

/**
 * Injected effects that record what was asked of them.
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
  it('accepts owner-only modes and refuses any crack of daylight', () => {
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

  it('is not confused by the colon inside the Windows path it strips', () => {
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

  it('refuses a listing it could not parse rather than assuming the best', () => {
    expect(aclIsPrivate('', KEY, 'dtira')).toBe(false);
    expect(aclIsPrivate('Access is denied.', KEY, 'dtira')).toBe(false);
  });
});

describe('hardening a secret on POSIX', () => {
  it('sets owner-only mode and confirms it landed', async () => {
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
  it('inspects without touching, on either platform', async () => {
    const posix = ops();
    await assertPrivate('/home/x/paw/identity/ca.key', 'linux', posix);
    // The distinction from hardening is the whole point: repairing a key the
    // daemon did not just write would erase the evidence it is looking for.
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

    // A silent chmod back to 0600 would make the one boot where another account
    // could read the key indistinguishable from every other boot.
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

  it('refuses to serve when an entry survived the grant', async () => {
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
