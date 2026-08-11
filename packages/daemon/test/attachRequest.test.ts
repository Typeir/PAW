/**
 * PAW Attach Request Session Tests
 *
 * @fileoverview Cover daemon part in attach request. Daemon forwards each attach request to the handler passed by the console and reports where approval happens. Tests fix the boundary: daemon grants no filesystem authority, does not call handler before authentication, rejects when no handler present, and never drops a request without an error response.
 *
 * @module @paw/daemon/test/attachRequest
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  authFrame,
  encodeAttach,
  encodeRelease,
  encodeScope,
  parseEnvelope,
  type PawSnapshot,
  type RunSettings,
} from '@paw/core';
import { describe, expect, it } from 'vitest';
import { createSession } from '../src/application/session.js';
import type { SessionDeps, WsSessionPort } from '../src/domain/session.js';

const TOKEN = 'a-token';

/**
 * Fake socket records what was sent and how it was closed.
 *
 * @returns {WsSessionPort & { sent: string[]; closed: Array<[number, string]> }} The port.
 */
function fakePort(): WsSessionPort & {
  sent: string[];
  closed: [number, string][];
} {
  const port = {
    sent: [] as string[],
    closed: [] as [number, string][],
    send: (text: string): void => {
      port.sent.push(text);
    },
    close: (code: number, reason: string): void => {
      port.closed.push([code, reason]);
    },
    bufferedAmount: (): number => 0,
  };
  return port;
}

/**
 * Session deps record attach requests.
 *
 * @param {boolean} listening - Whether `onAttach` handler supplied.
 * @returns {SessionDeps & { requests: Array<[string, string]> }} The deps.
 */
function fakeDeps(
  listening = true,
): SessionDeps & { requests: [string, string][] } {
  const requests: [string, string][] = [];
  return {
    requests,
    token: TOKEN,
    clock: (): number => 0,
    snapshot: async (): Promise<PawSnapshot> => ({}) as PawSnapshot,
    plans: (): readonly string[] => [],
    warn: (): void => {},
    ...(listening
      ? {
          onAttach: (path: string, mode: string): void => {
            requests.push([path, mode]);
          },
        }
      : {}),
  } as SessionDeps & { requests: [string, string][] };
}

/**
 * Watcher no test asserts against.
 *
 * @returns {object} The watcher.
 */
const noopWatcher = () => ({
  onAuthenticated: (): void => {},
  onAuthFailed: (): void => {},
  onClosed: (): void => {},
});

describe('attach requests', () => {
  it('hands the request to the shell and points the console at the terminal', async () => {
    const port = fakePort();
    const deps = fakeDeps();
    const session = createSession(port, deps, noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeAttach('/repo/thing', 'merge'));

    expect(deps.requests).toEqual([['/repo/thing', 'merge']]);
    const last = parseEnvelope(port.sent[port.sent.length - 1]);
    expect(last?.data).toEqual({
      code: 'attach-pending',
      message: 'approve this in the terminal running pawd',
    });
    expect(session.state()).toBe('live');
  });

  it('does not change what the session is watching', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeAttach('/repo/thing', 'override'));

    expect(session.watching()).toBeNull();
  });

  it('refuses when nobody is listening, rather than accepting silently', async () => {
    const port = fakePort();
    const deps = fakeDeps(false);
    const session = createSession(port, deps, noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeAttach('/repo/thing', 'merge'));

    expect(deps.requests).toEqual([]);
    expect(parseEnvelope(port.sent[port.sent.length - 1])?.data).toEqual({
      code: 'attach-unavailable',
      message: 'this daemon cannot take attach requests',
    });
  });

  it('never reaches the handler before authentication', async () => {
    const port = fakePort();
    const deps = fakeDeps();
    const session = createSession(port, deps, noopWatcher(), null);

    await session.receive(encodeAttach('/repo/thing', 'override'));

    expect(deps.requests).toEqual([]);
    expect(session.state()).toBe('closed');
    expect(port.sent).toEqual([]);
  });

  it('scopes to a directory beneath the ceiling without asking anyone', async () => {
    const port = fakePort();
    const scoped: string[] = [];
    const deps = {
      ...fakeDeps(),
      scopeCeiling: '/home/x',
      onScope: (path: string): void => {
        scoped.push(path);
      },
    } as SessionDeps & { requests: [string, string][] };
    const session = createSession(port, deps, noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeScope('/home/x/work/thing'));

    expect(scoped).toEqual(['/home/x/work/thing']);
    expect(session.state()).toBe('live');
  });

  it('refuses a directory outside the ceiling', async () => {
    const port = fakePort();
    const scoped: string[] = [];
    const deps = {
      ...fakeDeps(),
      scopeCeiling: '/home/x',
      onScope: (path: string): void => {
        scoped.push(path);
      },
    } as SessionDeps & { requests: [string, string][] };
    const session = createSession(port, deps, noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeScope('/etc'));

    expect(scoped).toEqual([]);
    expect(parseEnvelope(port.sent[port.sent.length - 1])?.data).toEqual({
      code: 'scope-refused',
      message: 'that directory is outside the operator’s home',
    });
  });

  it('refuses every scope request when the daemon is already scoped', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeScope('/home/x/work'));

    expect(parseEnvelope(port.sent[port.sent.length - 1])?.data).toEqual({
      code: 'scope-unavailable',
      message: 'this daemon is already scoped to a repository',
    });
  });

  it('refuses a scope request when no ceiling was configured', async () => {
    const port = fakePort();
    const scoped: string[] = [];
    const deps = {
      ...fakeDeps(),
      onScope: (path: string): void => {
        scoped.push(path);
      },
    } as SessionDeps & { requests: [string, string][] };
    const session = createSession(port, deps, noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeScope('/home/x/work'));

    expect(scoped).toEqual([]);
    expect(parseEnvelope(port.sent[port.sent.length - 1])?.data).toEqual({
      code: 'scope-refused',
      message: 'that directory is outside the operator’s home',
    });
  });

  it('closes on a mode the protocol does not define', async () => {
    const port = fakePort();
    const deps = fakeDeps();
    const session = createSession(port, deps, noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive('{"v":1,"m":"t","p":"/repo","d":"delete-everything"}');

    expect(deps.requests).toEqual([]);
    expect(session.state()).toBe('closed');
  });
});

/**
 * Session deps record release requests.
 *
 * @param {boolean} listening - Whether `onRelease` handler supplied.
 * @returns {SessionDeps & { released: RunSettings[] }} The deps.
 */
function releaseDeps(listening = true): SessionDeps & { released: RunSettings[] } {
  const released: RunSettings[] = [];
  return {
    released,
    token: TOKEN,
    clock: (): number => 0,
    snapshot: async (): Promise<PawSnapshot> => ({}) as PawSnapshot,
    plans: (): readonly string[] => [],
    warn: (): void => {},
    ...(listening
      ? {
          onRelease: (settings: RunSettings): void => {
            released.push(settings);
          },
        }
      : {}),
  } as SessionDeps & { released: RunSettings[] };
}

describe('release requests', () => {
  it('hands the request to the shell and points the console at the terminal', async () => {
    const port = fakePort();
    const deps = releaseDeps();
    const session = createSession(port, deps, noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeRelease({ plan: 'plans/lore.swarm.mjs', live: true, maxOutputTokens: 512 }));

    expect(deps.released).toEqual([{ plan: 'plans/lore.swarm.mjs', live: true, maxOutputTokens: 512 }]);
    expect(parseEnvelope(port.sent[port.sent.length - 1])?.data).toEqual({
      code: 'release-pending',
      message: 'approve this in the terminal running pawd',
    });
    expect(session.state()).toBe('live');
  });

  it('refuses when nobody is listening, rather than spending silently', async () => {
    const port = fakePort();
    const deps = releaseDeps(false);
    const session = createSession(port, deps, noopWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(encodeRelease({ plan: 'p', live: false }));

    expect(deps.released).toEqual([]);
    expect(parseEnvelope(port.sent[port.sent.length - 1])?.data).toEqual({
      code: 'release-unavailable',
      message: 'this daemon cannot take release requests',
    });
  });
});
