/**
 * PAW Session Registry
 *
 * @fileoverview Hold every open session. Upgrade gate read count: plenty authed, plenty not, plenty credentials refused. Keep failed-auth tally, report it but never lockout. Track plans live sessions watch. Fan published slice out to every session. Close all when daemon die.
 *
 * @module @paw/daemon/application/sessionRegistry
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { CLOSE_SHUTDOWN, MAX_AUTH_FAILURES, type LiveTopic, type LiveTopicMap } from '@paw/core';
import type { LiveSession, SessionDeps, SessionRegistry, WsSessionPort } from '../domain/session.js';
import { createSession } from './session.js';

/**
 * Build the registry.
 *
 * @param {SessionDeps} deps - What sessions need.
 * @returns {SessionRegistry} The registry.
 */
export function createSessionRegistry(deps: SessionDeps): SessionRegistry {
  const sessions = new Set<LiveSession>();
  let failures = 0;

  return {
    open: (port: WsSessionPort, openedOn: string | null): LiveSession => {
      const session = createSession(
        port,
        deps,
        {
          onAuthenticated: () => undefined,
          onAuthFailed: () => {
            failures += 1;
            if (failures % MAX_AUTH_FAILURES === 0) {
              deps.warn(
                `${failures} failed live-wire authentications so far — ` +
                  `something on this machine is guessing at the console's credential`,
              );
            }
          },
          onClosed: () => {
            sessions.delete(session);
          },
        },
        openedOn,
      );
      sessions.add(session);
      return session;
    },

    live: () => [...sessions].filter((session) => session.state() === 'live').length,

    preAuth: () => [...sessions].filter((session) => session.state() === 'pre-auth').length,

    failedAuths: () => failures,

    watched: () => [
      ...new Set(
        [...sessions]
          .filter((session) => session.state() === 'live')
          .map((session) => session.watching())
          .filter((plan): plan is string => plan !== null),
      ),
    ],

    broadcast: <T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void => {
      for (const session of [...sessions]) {
        session.emit(topic, data);
      }
    },

    tick: (nowMs: number): void => {
      for (const session of [...sessions]) {
        session.tick(nowMs);
      }
    },

    shutdown: (): void => {
      for (const session of [...sessions]) {
        session.close(CLOSE_SHUTDOWN, 'pawd is shutting down');
      }
    },
  };
}
