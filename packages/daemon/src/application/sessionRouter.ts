/**
 * PAW Session Request Router
 *
 * @fileoverview Three out-of-band requests live console send — scope, attach,
 * release. Daemon part in each. Scope read held to ceiling. Attach and release
 * record console intent; daemon gain no authority until operator approve in
 * terminal that start it. Each return frame to send back.
 *
 * @module @paw/daemon/application/sessionRouter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { withinRoot, type InitMode, type LiveTopicMap, type RunSettings } from '@paw/core';
import type { SessionDeps } from '../domain/session.js';

/**
 * Point daemon at repository, or report why not. Scoping is read: change what
 * daemon look at, write nothing. No operator ask; held to ceiling. Daemon start
 * against fixed repository supply no `onScope` and refuse; one with no ceiling
 * refuse too.
 *
 * @param {string} path - Directory console name.
 * @param {SessionDeps} deps - What session built with.
 * @returns {LiveTopicMap['error'] | null} Problem to report, or null after dispatch.
 */
export function dispatchScope(path: string, deps: SessionDeps): LiveTopicMap['error'] | null {
  const { onScope, scopeCeiling } = deps;
  if (onScope === undefined) {
    return {
      code: 'scope-unavailable',
      message: 'this daemon is already scoped to a repository',
    };
  }
  if (!withinRoot(path, scopeCeiling ?? '')) {
    return {
      code: 'scope-refused',
      message: 'that directory is outside the operator’s home',
    };
  }
  onScope(path);
  return null;
}

/**
 * Record console ask for PAW attach to repository. Daemon store request,
 * gain no authority until operator approve out-of-band. Process that already
 * hold authority do the write. Always answer.
 *
 * @param {string} path - Repository console name.
 * @param {InitMode} mode - How it ask for existing config to resolve.
 * @param {SessionDeps} deps - What session built with.
 * @returns {LiveTopicMap['error']} What to tell console.
 */
export function dispatchAttach(
  path: string,
  mode: InitMode,
  deps: SessionDeps,
): LiveTopicMap['error'] {
  const { onAttach } = deps;
  if (onAttach === undefined) {
    return {
      code: 'attach-unavailable',
      message: 'this daemon cannot take attach requests',
    };
  }
  onAttach(path, mode);
  return {
    code: 'attach-pending',
    message: 'approve this in the terminal running pawd',
  };
}

/**
 * Record console ask to release a plan. Symmetric to
 * {@link dispatchAttach}: daemon run nothing until operator
 * approve in terminal. CLI's standalone runner need no approval.
 *
 * @param {RunSettings} settings - What console ask to run and how.
 * @param {SessionDeps} deps - What session built with.
 * @returns {LiveTopicMap['error']} What to tell console.
 */
export function dispatchRelease(settings: RunSettings, deps: SessionDeps): LiveTopicMap['error'] {
  const { onRelease } = deps;
  if (onRelease === undefined) {
    return {
      code: 'release-unavailable',
      message: 'this daemon cannot take release requests',
    };
  }
  onRelease(settings);
  return {
    code: 'release-pending',
    message: 'approve this in the terminal running pawd',
  };
}
