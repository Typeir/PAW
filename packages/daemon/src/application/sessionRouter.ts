/**
 * PAW Session Request Router
 *
 * @fileoverview The three out-of-band requests a live console may send — scope,
 * attach, release — and the daemon's narrow part in each. Scope is a read held to
 * a ceiling; attach and release only *ask*, and the daemon spends nothing and
 * gains no authority until the operator approves in the terminal that started it.
 * Each returns the frame to send back, so the session machine stays a router and
 * these hold the policy.
 *
 * @module @paw/daemon/application/sessionRouter
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { withinRoot, type InitMode, type LiveTopicMap, type RunSettings } from '@paw/core';
import type { SessionDeps } from '../domain/session.js';

/**
 * Point the daemon at a repository, or say why not. Scoping is a read — it changes
 * what the daemon looks at and writes nothing — so no operator is asked; what it
 * is held to is a ceiling. A daemon started against a fixed repository supplies no
 * `onScope` and refuses; one with no ceiling refuses too, rather than treating an
 * absent bound as an open one.
 *
 * @param {string} path - The directory the console named.
 * @param {SessionDeps} deps - What the session was built with.
 * @returns {LiveTopicMap['error'] | null} The problem to report, or null once dispatched.
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
 * Record that a console asked for PAW to be attached to a repository. The daemon's
 * entire part is remembering that someone asked: it writes nothing, resolves
 * nothing, and gains no filesystem authority. An operator approves out-of-band,
 * and the process that already holds authority performs the write — so killing the
 * daemon mid-flow leaves nothing half-done. Always answers, because a console told
 * nothing cannot tell a request in progress from one that was dropped.
 *
 * @param {string} path - The repository the console named.
 * @param {InitMode} mode - How it asked for an existing config to be resolved.
 * @param {SessionDeps} deps - What the session was built with.
 * @returns {LiveTopicMap['error']} What to tell the console.
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
 * Record that a console asked for a plan's herd to be released. Symmetric to
 * {@link dispatchAttach}: the daemon spends nothing and runs nothing until the
 * operator approves in the terminal, which is what keeps a console-triggered live
 * herd non-autonomous. The CLI's standalone runner is the path that needs no
 * approval.
 *
 * @param {RunSettings} settings - What the console asked to run and how.
 * @param {SessionDeps} deps - What the session was built with.
 * @returns {LiveTopicMap['error']} What to tell the console.
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
