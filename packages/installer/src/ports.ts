/**
 * PAW Installer Ports
 *
 * @fileoverview The side-effect boundaries the installer depends on. The Windows
 * per-user environment store is the installer's own — nothing else in PAW edits
 * a registry — so it is defined here. The filesystem is not: `@paw/core` owns
 * that port, because attaching a repository is a core use-case and a port with
 * two definitions is a port that drifts. It is re-exported for the installer's
 * own consumers.
 *
 * The pure planners never touch either; the application layer drives them, and
 * `main.ts` binds the real adapters (`@paw/adapters` and a PowerShell
 * `[Environment]` call).
 *
 * @module @paw/installer/ports
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export type { FileSystemPort } from '@paw/core';

/**
 * The Windows per-user environment store, edited via the OS API so the change is
 * persisted and broadcast without `setx` and without admin.
 *
 * @interface EnvironmentPort
 * @property {() => Promise<string>} getUserPath - Read the current user `Path`.
 * @property {(value: string) => Promise<void>} setUserPath - Persist a new user `Path` and broadcast the change.
 */
export interface EnvironmentPort {
  getUserPath(): Promise<string>;
  setUserPath(value: string): Promise<void>;
}
