/**
 * PAW Installer — Public API
 *
 * @fileoverview The pure planners and the port-driven application layer for
 * installing and activating PAW. `main.ts` (the argv + real-adapter shell) and the
 * `adapters/` (the OS writes) consume these; nothing here performs I/O directly.
 *
 * @module @paw/installer
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { detectShell, profileTarget, WINDOWS_ENV } from './shell.js';
export type { Shell } from './shell.js';

export { MARK_BEGIN, MARK_END, planPathEdit } from './path.js';
export type { PathEdit, PathEditKind, PathPlanInput } from './path.js';

export { findRepoRoot } from './repo.js';

export { activatePath } from './apply.js';
export type { ActivateInput } from './apply.js';

export type { EnvironmentPort, FileSystemPort } from './ports.js';
