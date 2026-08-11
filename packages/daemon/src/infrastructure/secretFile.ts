/**
 * Secret File Permissions
 *
 * @fileoverview Make private key private, on platform it land. Then prove it. Local CA key any account on machine can read worse than no CA: operator trust key, so whoever read inherits that trust.
 *
 * Writing with restrictive mode no enough. Umask, inherited ACL, filesystem with no POSIX modes (Windows share, exFAT stick, bind mount) all leave file wider than write ask, and every failure silent. So harden each secret, then **read back**: permissions land no match demanded, daemon refuse to serve, no keep going with exposed key.
 *
 * Both platform branches pure over {@link SecretOps}, so test POSIX rules from Windows and Windows rules from POSIX. Neither left to CI runner that happen to be one.
 *
 * @module @paw/daemon/secretFile
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Mode private key must end up with: readable, writable by owner, invisible to everyone else.
 */
export const SECRET_MODE = 0o600;

/**
 * Mode directory holding them must end up with.
 */
export const SECRET_DIR_MODE = 0o700;

/**
 * Windows grant for secret file — full control, to one account.
 */
export const SECRET_GRANT = 'F';

/**
 * Windows grant for directory. `(OI)(CI)` make it default for stuff created inside, so key written later inherit same single-account ACL.
 */
export const SECRET_DIR_GRANT = '(OI)(CI)F';

/**
 * Effects hardening need, injected so both platform branches testable from either platform.
 *
 * @interface SecretOps
 * @property {(path: string, mode: number) => Promise<void>} chmod - Set POSIX mode.
 * @property {(path: string) => Promise<number>} statMode - Read back mode that land.
 * @property {(command: string, args: readonly string[]) => Promise<string>} run - Run program, return its stdout.
 * @property {() => string} user - Account own this process.
 */
export interface SecretOps {
  chmod(path: string, mode: number): Promise<void>;
  statMode(path: string): Promise<number>;
  run(command: string, args: readonly string[]): Promise<string>;
  user(): string;
}

/**
 * Whether POSIX mode keep group and other out entirely.
 *
 * @param {number} mode - The mode as `stat` report it, file-type bits included.
 * @returns {boolean} True when nobody but owner have access.
 */
export function modeIsPrivate(mode: number): boolean {
  return (mode & 0o077) === 0;
}

/**
 * Accounts an `icacls` listing grant access to.
 *
 * Listing put path on first line, then first entry, then one indented entry per line, then summary. Entry be `PRINCIPAL:(RIGHTS)`, principal may hold spaces (`NT AUTHORITY\SYSTEM`), so split on first `:(`, no on whitespace. Strip path by value, no by pattern, because Windows path hold colon of its own.
 *
 * @param {string} output - What `icacls <path>` printed.
 * @param {string} path - The path it asked about.
 * @returns {string[]} The principals, in listing order.
 */
export function aclPrincipals(output: string, path: string): string[] {
  const principals: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.startsWith(path) ? raw.slice(path.length) : raw;
    const cut = line.indexOf(':(');
    if (cut === -1) {
      continue;
    }
    const principal = line.slice(0, cut).trim();
    if (principal !== '') {
      principals.push(principal);
    }
  }
  return principals;
}

/**
 * Whether `icacls` listing grant access to one account and no other.
 *
 * Compare principal as bare account name or domain-qualified one — `icacls` echo back `MACHINE\user` for grant made as `user`. Empty listing count as **not** private: parse find nothing understood, unreadable answer no permission to go on.
 *
 * @param {string} output - What `icacls <path>` printed.
 * @param {string} path - The path it asked about.
 * @param {string} user - The account may have access.
 * @returns {boolean} True when that account only one listed.
 */
export function aclIsPrivate(output: string, path: string, user: string): boolean {
  const principals = aclPrincipals(output, path);
  if (principals.length === 0) {
    return false;
  }
  const bare = user.toLowerCase();
  const qualified = `\\${bare}`;
  return principals.every((principal) => {
    const lower = principal.toLowerCase();
    return lower === bare || lower.endsWith(qualified);
  });
}

/**
 * Restrict path to this account, then verify it land that way.
 *
 * @param {string} path - The file or directory to harden.
 * @param {string} platform - The platform, as `os.platform()` report it.
 * @param {SecretOps} ops - The effects to do it with.
 * @param {number} mode - The POSIX mode to demand.
 * @param {string} grant - The Windows rights to grant.
 * @returns {Promise<void>} Resolves when path provably private.
 * @throws {Error} When permissions that land wider than demanded.
 */
export async function hardenPath(
  path: string,
  platform: string,
  ops: SecretOps,
  mode: number,
  grant: string,
): Promise<void> {
  const user = ops.user();
  if (platform === 'win32') {
    await ops.run('icacls', [path, '/inheritance:r', '/grant:r', `${user}:${grant}`]);
    const listing = await ops.run('icacls', [path]);
    if (!aclIsPrivate(listing, path, user)) {
      throw new Error(
        `refusing to serve: ${path} is not restricted to ${user}. icacls reports:\n${listing}`,
      );
    }
    return;
  }
  await ops.chmod(path, mode);
  const landed = await ops.statMode(path);
  if (!modeIsPrivate(landed)) {
    throw new Error(
      `refusing to serve: ${path} landed as mode ${(landed & 0o777).toString(8)}, which others can read`,
    );
  }
}

/**
 * Make private key readable by owner alone.
 *
 * @param {string} path - The key file.
 * @param {string} platform - The platform.
 * @param {SecretOps} ops - The effects.
 * @returns {Promise<void>} Resolves when key provably private.
 */
export function hardenSecret(path: string, platform: string, ops: SecretOps): Promise<void> {
  return hardenPath(path, platform, ops, SECRET_MODE, SECRET_GRANT);
}

/**
 * Check existing key still readable by owner alone, **without changing it**.
 *
 * Unlike {@link hardenSecret}, this only checks permissions; it never sets them. Hardening correct at moment key written: daemon own file, know what it should be, set it. Repairing key it did *not* just write erase evidence it look for — key other local account could read be compromise indicator, silent chmod it back to private every boot make one boot where somebody read access look same as every other. So key found wrong reported and refused, never quietly fixed.
 *
 * @param {string} path - The key file.
 * @param {string} platform - The platform, as `os.platform()` report it.
 * @param {SecretOps} ops - The effects.
 * @returns {Promise<void>} Resolves when key provably private.
 * @throws {Error} When anyone but this account can read it.
 */
export async function assertPrivate(
  path: string,
  platform: string,
  ops: SecretOps,
): Promise<void> {
  const user = ops.user();
  if (platform === 'win32') {
    const listing = await ops.run('icacls', [path]);
    if (!aclIsPrivate(listing, path, user)) {
      throw new Error(
        `refusing to serve: ${path} is readable by more than ${user}, and was not written ` +
          `this boot — someone changed it. icacls reports:\n${listing}`,
      );
    }
    return;
  }
  const mode = await ops.statMode(path);
  if (!modeIsPrivate(mode)) {
    throw new Error(
      `refusing to serve: ${path} is mode ${(mode & 0o777).toString(8)}, and was not written ` +
        `this boot — someone changed it`,
    );
  }
}

/**
 * Make identity directory enterable by owner alone, so key written into it later inherit same restriction.
 *
 * @param {string} path - The directory.
 * @param {string} platform - The platform.
 * @param {SecretOps} ops - The effects.
 * @returns {Promise<void>} Resolves when directory provably private.
 */
export function hardenSecretDir(path: string, platform: string, ops: SecretOps): Promise<void> {
  return hardenPath(path, platform, ops, SECRET_DIR_MODE, SECRET_DIR_GRANT);
}
