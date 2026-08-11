/**
 * PAW Installer Ports
 *
 * @fileoverview Side-effect boundaries installer need. Windows per-user
 * environment store belongs to installer — nothing else in PAW touches the
 * registry — so define it here. Filesystem port stays in `@paw/core`; attaching
 * a directory to a repo is a core use-case, and defining the port once avoids
 * drift between `@paw/core` and installer. Re-export for installer's own
 * consumers.
 *
 * Pure planners do not touch either; the application layer drives them, and
 * `main.ts` binds adapters (`@paw/adapters` and PowerShell `[Environment]` call).
 *
 * @module @paw/installer/ports
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export type { FileSystemPort } from '@paw/core';

/**
 * Windows per-user environment store, edited via OS registry API so changes
 * persist and broadcast without `setx` and without admin.
 *
 * @interface EnvironmentPort
 * @property {() => Promise<string>} getUserPath - Read current user `Path`.
 * @property {(value: string) => Promise<void>} setUserPath - Persist new user `Path` and broadcast change.
 */
export interface EnvironmentPort {
  getUserPath(): Promise<string>;
  setUserPath(value: string): Promise<void>;
}
