/**
 * @fileoverview Password hashing and verification utilities for the PAW CLI.
 *
 * Stores a salted SHA-256 hash in `.paw/.pawsecret`. The file format is a
 * single line: `<hex-salt>:<hex-hash>` where hash = SHA-256(salt + password).
 *
 * @module .github/PAW/cli/password
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAW_DIR } from '../paw-paths';

/** Path to the secret file storing the salted hash. */
const SECRET_PATH = join(PAW_DIR, '.pawsecret');

/**
 * Hash a password with a random salt using SHA-256.
 *
 * @param password - The plaintext password to hash
 * @returns An object containing the hex-encoded salt and hash
 */
function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256')
    .update(salt + password)
    .digest('hex');
  return { salt, hash };
}

/**
 * Verify a plaintext password against a stored salt and hash.
 *
 * @param password - The plaintext password to verify
 * @param salt - The hex-encoded salt
 * @param storedHash - The hex-encoded expected hash
 * @returns True if the password matches
 */
function verifyPassword(
  password: string,
  salt: string,
  storedHash: string,
): boolean {
  const hash = createHash('sha256')
    .update(salt + password)
    .digest('hex');
  return hash === storedHash;
}

/**
 * Save a hashed password to the `.pawsecret` file.
 *
 * @param password - The plaintext password to hash and store
 */
export function savePassword(password: string): void {
  const { salt, hash } = hashPassword(password);
  writeFileSync(SECRET_PATH, `${salt}:${hash}`, 'utf-8');
}

/**
 * Check whether a `.pawsecret` file exists (i.e., a password has been set).
 *
 * @returns True if the secret file exists
 */
export function hasPassword(): boolean {
  return existsSync(SECRET_PATH);
}

/**
 * Verify a plaintext password against the stored `.pawsecret`.
 *
 * @param password - The plaintext password to verify
 * @returns True if the password matches the stored hash
 * @throws Error if no password has been set
 */
export function checkPassword(password: string): boolean {
  if (!existsSync(SECRET_PATH)) {
    throw new Error('No password set. Run `paw set-password` first.');
  }
  const raw = readFileSync(SECRET_PATH, 'utf-8').trim();
  const [salt, storedHash] = raw.split(':');
  if (!salt || !storedHash) {
    throw new Error('Corrupt .pawsecret file. Run `paw set-password` again.');
  }
  return verifyPassword(password, salt, storedHash);
}
