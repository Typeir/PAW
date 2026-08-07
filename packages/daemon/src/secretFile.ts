/**
 * Secret File Permissions
 *
 * @fileoverview Making a private key private, on the platform it lands on, and
 * proving it afterwards. A local CA key that any account on the machine can read
 * is worse than no CA at all: the operator has been asked to trust it, so
 * whoever reads it inherits that trust.
 *
 * Writing with a restrictive mode is not enough to rely on. A umask, an
 * inherited ACL, a filesystem that does not carry POSIX modes at all (a Windows
 * share, an exFAT stick, a bind mount) can all leave the file wider than the
 * write asked for, and every one of those failures is silent. So each secret is
 * hardened and then **read back**: if the permissions that landed are not the
 * permissions demanded, the daemon refuses to serve rather than continuing with
 * an exposed key.
 *
 * Both platform branches are pure over {@link SecretOps}, so the POSIX rules are
 * tested from Windows and the Windows rules from POSIX, and neither is left to a
 * CI runner that happens to be one of them.
 *
 * @module @paw/daemon/secretFile
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The mode a private key must end up with: readable and writable by its owner,
 * invisible to everyone else.
 */
export const SECRET_MODE = 0o600;

/**
 * The mode the directory holding them must end up with.
 */
export const SECRET_DIR_MODE = 0o700;

/**
 * The Windows grant for a secret file — full control, to one account.
 */
export const SECRET_GRANT = 'F';

/**
 * The Windows grant for the directory. `(OI)(CI)` makes it the default for what
 * is created inside, so a key written later inherits the same single-account ACL.
 */
export const SECRET_DIR_GRANT = '(OI)(CI)F';

/**
 * The effects hardening needs, injected so both platform branches are testable
 * from either platform.
 *
 * @interface SecretOps
 * @property {(path: string, mode: number) => Promise<void>} chmod - Set a POSIX mode.
 * @property {(path: string) => Promise<number>} statMode - Read back the mode that landed.
 * @property {(command: string, args: readonly string[]) => Promise<string>} run - Run a program and return its stdout.
 * @property {() => string} user - The account that owns this process.
 */
export interface SecretOps {
  chmod(path: string, mode: number): Promise<void>;
  statMode(path: string): Promise<number>;
  run(command: string, args: readonly string[]): Promise<string>;
  user(): string;
}

/**
 * Whether a POSIX mode keeps group and other out entirely.
 *
 * @param {number} mode - The mode as `stat` reports it, file-type bits included.
 * @returns {boolean} True when nobody but the owner has any access.
 */
export function modeIsPrivate(mode: number): boolean {
  return (mode & 0o077) === 0;
}

/**
 * The accounts an `icacls` listing grants access to.
 *
 * The listing puts the path on the first line followed by its first entry, then
 * one indented entry per line, then a summary. An entry is `PRINCIPAL:(RIGHTS)`,
 * and a principal may contain spaces (`NT AUTHORITY\SYSTEM`), so the split is on
 * the first `:(` rather than on whitespace. The path is stripped by value rather
 * than by pattern, because a Windows path contains a colon of its own.
 *
 * @param {string} output - What `icacls <path>` printed.
 * @param {string} path - The path it was asked about.
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
 * Whether an `icacls` listing grants access to one account and no other.
 *
 * A principal is compared as either the bare account name or a domain-qualified
 * one — `icacls` echoes back `MACHINE\user` for a grant made as `user`. An empty
 * listing counts as **not** private: it means the parse found nothing it
 * understood, and an unreadable answer is not permission to continue.
 *
 * @param {string} output - What `icacls <path>` printed.
 * @param {string} path - The path it was asked about.
 * @param {string} user - The account that may have access.
 * @returns {boolean} True when that account is the only one listed.
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
 * Restrict a path to this account, then verify it landed that way.
 *
 * @param {string} path - The file or directory to harden.
 * @param {string} platform - The platform, as `os.platform()` reports it.
 * @param {SecretOps} ops - The effects to do it with.
 * @param {number} mode - The POSIX mode to demand.
 * @param {string} grant - The Windows rights to grant.
 * @returns {Promise<void>} Resolves when the path is provably private.
 * @throws {Error} When the permissions that landed are wider than demanded.
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
 * Make a private key readable by its owner alone.
 *
 * @param {string} path - The key file.
 * @param {string} platform - The platform.
 * @param {SecretOps} ops - The effects.
 * @returns {Promise<void>} Resolves when the key is provably private.
 */
export function hardenSecret(path: string, platform: string, ops: SecretOps): Promise<void> {
  return hardenPath(path, platform, ops, SECRET_MODE, SECRET_GRANT);
}

/**
 * Check that an existing key is still readable by its owner alone, **without
 * changing it**.
 *
 * The distinction from {@link hardenSecret} is the whole point of this function.
 * Hardening is correct at the moment a key is written: the daemon owns the file,
 * knows what it should be, and sets it. Repairing a key it did *not* just write
 * would erase the evidence it is looking for — a key another local account could
 * read is a compromise indicator, and silently chmod-ing it back to private on
 * every boot means the one boot where somebody had read access looks identical
 * to every other. So a key that was found wrong is reported and refused, never
 * quietly corrected.
 *
 * @param {string} path - The key file.
 * @param {string} platform - The platform, as `os.platform()` reports it.
 * @param {SecretOps} ops - The effects.
 * @returns {Promise<void>} Resolves when the key is provably private.
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
 * Make the identity directory enterable by its owner alone, so a key written
 * into it later inherits the same restriction.
 *
 * @param {string} path - The directory.
 * @param {string} platform - The platform.
 * @param {SecretOps} ops - The effects.
 * @returns {Promise<void>} Resolves when the directory is provably private.
 */
export function hardenSecretDir(path: string, platform: string, ops: SecretOps): Promise<void> {
  return hardenPath(path, platform, ops, SECRET_DIR_MODE, SECRET_DIR_GRANT);
}
