/**
 * PAW Installer — Public API
 *
 * @fileoverview Pure planners and port-driven app layer for install and activate
 * PAW. `main.ts` (argv + real-adapter shell) and `adapters/` (OS writes) consume
 * these; nothing here do I/O direct.
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
