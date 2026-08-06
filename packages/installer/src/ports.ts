/**
 * PAW Installer Ports
 *
 * @fileoverview The two side-effect boundaries the installer depends on, as
 * interfaces: a filesystem and the Windows per-user environment store. The pure
 * planners never touch either; the application layer drives them, and `main.ts`
 * binds the real adapters (`node:fs` and a PowerShell `[Environment]` call). Small
 * by design — interface segregation — so a test fakes exactly what a case needs.
 *
 * @module @paw/installer/ports
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Filesystem operations the installer needs.
 *
 * @interface FileSystemPort
 * @property {(path: string) => Promise<string>} readText - Read a file, or `''` when it does not exist.
 * @property {(path: string, content: string) => Promise<void>} writeText - Write (creating/overwriting) a file.
 * @property {(path: string, content: string) => Promise<void>} appendText - Append to a file, creating it if absent.
 * @property {(dir: string) => Promise<void>} ensureDir - Create a directory and parents if needed.
 * @property {(path: string) => Promise<void>} setExecutable - Set the executable bit (a no-op on Windows).
 */
export interface FileSystemPort {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  appendText(path: string, content: string): Promise<void>;
  ensureDir(dir: string): Promise<void>;
  setExecutable(path: string): Promise<void>;
}

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
