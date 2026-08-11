/**
 * Live session tests.
 *
 * @fileoverview Socket security: nothing is written before a client authenticates.
 *
 * The first group covers the pre-auth paths — wrong token, `watch` first,
 * malformed frame, timeout. Each asserts `send` is never called. Other tests
 * inspect the frame a session does send once it accepts one.
 *
 * @module @paw/daemon/test/sessions
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  AUTH_TIMEOUT_MS,
  BACKPRESSURE_CLOSE_BYTES,
  BACKPRESSURE_RESUME_BYTES,
  BACKPRESSURE_SKIP_BYTES,
  BACKPRESSURE_STALE_MS,
  CLOSE_AUTH,
  CLOSE_BACKPRESSURE,
  CLOSE_CAPACITY,
  CLOSE_MALFORMED,
  CLOSE_SHUTDOWN,
  MAX_AUTH_FAILURES,
  MAX_MESSAGES_PER_WINDOW,
  MESSAGE_WINDOW_MS,
  authFrame,
  parseEnvelope,
  watchFrame,
  type PawSnapshot,
} from '@paw/core';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from '../src/application/session.js';
import { createSessionRegistry } from '../src/application/sessionRegistry.js';
import type { SessionDeps, WsSessionPort } from '../src/domain/session.js';

const TOKEN = 'a-token-worth-256-bits-or-so-really';
const PLANS = ['plans/lore.swarm.mjs', 'plans/edit.swarm.mjs'];

/**
 * The snapshot names the plan it was built for, so the `hello` frame shows
 * which plan the session is watching.
 *
 * @param {string | null} plan - Watched plan.
 * @returns {PawSnapshot} Snapshot.
 */
const snapshotFor = (plan: string | null): PawSnapshot =>
  ({ selectedPlan: plan, planName: plan === null ? '' : 'lore' }) as PawSnapshot;

/**
 * A fake socket record every write.
 *
 * @param {number} [buffered] - What `bufferedAmount` report.
 * @returns {WsSessionPort & { sent: string[]; closed: Array<[number, string]>; buffered: number }} Port.
 */
const fakePort = (
  buffered = 0,
): WsSessionPort & { sent: string[]; closed: Array<[number, string]>; buffered: number } => {
  const port = {
    sent: [] as string[],
    closed: [] as Array<[number, string]>,
    buffered,
    send: (text: string) => {
      port.sent.push(text);
    },
    close: (code: number, reason: string) => {
      port.closed.push([code, reason]);
    },
    bufferedAmount: () => port.buffered,
  };
  return port;
};

/**
 * Session deps over controllable clock.
 *
 * @param {Partial<SessionDeps>} [over] - Overrides.
 * @returns {SessionDeps & { at: number; warnings: string[] }} Deps.
 */
const fakeDeps = (
  over: Partial<SessionDeps> = {},
): SessionDeps & { at: number; warnings: string[] } => {
  const state = { at: 0, warnings: [] as string[] };
  return {
    get at(): number {
      return state.at;
    },
    set at(value: number) {
      state.at = value;
    },
    warnings: state.warnings,
    token: TOKEN,
    clock: (): number => state.at,
    snapshot: async (plan: string | null): Promise<PawSnapshot> => snapshotFor(plan),
    plans: (): readonly string[] => PLANS,
    warn: (message: string): void => {
      state.warnings.push(message);
    },
    ...over,
  };
};

/**
 * Counters session report to.
 *
 * @returns {object} Watcher and what it recorded.
 */
const fakeWatcher = (): {
  onAuthenticated: () => void;
  onAuthFailed: () => void;
  onClosed: () => void;
  authenticated: number;
  failed: number;
  closed: number;
} => {
  const watcher = {
    authenticated: 0,
    failed: 0,
    closed: 0,
    onAuthenticated: () => {
      watcher.authenticated += 1;
    },
    onAuthFailed: () => {
      watcher.failed += 1;
    },
    onClosed: () => {
      watcher.closed += 1;
    },
  };
  return watcher;
};

/**
 * Topics port sent, in order.
 *
 * @param {{ sent: string[] }} port - Fake port.
 * @returns {string[]} Topics.
 */
const topicsOf = (port: { sent: string[] }): string[] =>
  port.sent.map((frame) => parseEnvelope(frame)?.topic ?? '(unparseable)');

/**
 * Let queued microtasks finish, so a follow-up snapshot the session queued
 * during its own processing is sent before assertions read the socket.
 *
 * @returns {Promise<void>} Resolve once queue drained.
 */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe('a session before it has authenticated', () => {
  it('is sent nothing at all when the credential is wrong', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);

    await session.receive(authFrame('not-the-token'));

    expect(port.sent).toEqual([]);
    expect(port.closed).toEqual([[CLOSE_AUTH, 'bad credential']]);
    expect(session.state()).toBe('closed');
  });

  it('is sent nothing at all when it talks before authenticating', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);

    await session.receive(watchFrame('plans/lore.swarm.mjs'));

    expect(port.sent).toEqual([]);
    // Protocol-order fail, no refused credential: 4401 tell console token bad
    // and stop retry for life of page.
    expect(port.closed).toEqual([[CLOSE_MALFORMED, 'authenticate first']]);
  });

  it('is sent nothing at all when its frame is malformed', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);

    await session.receive('{"v":1,"type":"eval","code":"process.exit()"}');

    expect(port.sent).toEqual([]);
    expect(port.closed).toEqual([[CLOSE_MALFORMED, 'malformed frame']]);
  });

  it('is sent nothing at all when it never speaks', () => {
    const port = fakePort();
    const deps = fakeDeps();
    const session = createSession(port, deps, fakeWatcher(), null);

    session.tick(AUTH_TIMEOUT_MS - 1);
    expect(port.closed).toEqual([]);

    session.tick(AUTH_TIMEOUT_MS);
    expect(port.sent).toEqual([]);
    expect(port.closed).toEqual([[CLOSE_MALFORMED, 'no credential offered in time']]);
  });

  it('counts a wrong credential as a guess, and silence as no guess at all', async () => {
    const wrong = fakeWatcher();
    await createSession(fakePort(), fakeDeps(), wrong, null).receive(authFrame('nope'));
    expect(wrong.failed).toBe(1);

    // A socket that sent nothing tried nothing. Counting it would let any
    // local process inflate the failure count without touching the credential.
    const quiet = fakeWatcher();
    createSession(fakePort(), fakeDeps(), quiet, null).tick(AUTH_TIMEOUT_MS);
    expect(quiet.failed).toBe(0);
  });

  it('compares the credential without leaking its length through a throw', async () => {
    // Near-miss, prefix, suffix, and empty guess all close the same way. The
    // comparison hashes both sides first, so a length mismatch cannot throw
    // where an equal-length guess would not — a throw would reveal token length.
    for (const guess of ['x', TOKEN.slice(0, -1), `${TOKEN}x`, 'y'.repeat(512)]) {
      const port = fakePort();
      await createSession(port, fakeDeps(), fakeWatcher(), null).receive(
        authFrame(guess),
      );
      expect(port.sent).toEqual([]);
      expect(port.closed[0][0]).toBe(CLOSE_AUTH);
    }
  });

  it('refuses an oversize or empty credential as malformed, before comparing anything', async () => {
    for (const token of ['y'.repeat(5000), '']) {
      const port = fakePort();
      await createSession(port, fakeDeps(), fakeWatcher(), null).receive(authFrame(token));

      // Refuse on shape alone: the client cannot make the daemon hash five
      // kilobytes per attempt, and neither frame reaches the comparison. The
      // distinction is safe to expose — it says nothing about the real token.
      expect(port.sent).toEqual([]);
      expect(port.closed).toEqual([[CLOSE_MALFORMED, 'malformed frame']]);
    }
  });
});

describe('a session that authenticated', () => {
  it('is sent the whole state, for the plan it was opened on', async () => {
    const port = fakePort();
    const watcher = fakeWatcher();
    const session = createSession(port, fakeDeps(), watcher, 'plans/lore.swarm.mjs');

    await session.receive(authFrame(TOKEN));

    expect(session.state()).toBe('live');
    expect(watcher.authenticated).toBe(1);
    expect(topicsOf(port)).toEqual(['hello']);
    const hello = parseEnvelope(port.sent[0]);
    expect((hello?.data as PawSnapshot).selectedPlan).toBe('plans/lore.swarm.mjs');
  });

  it('is never shown the briefs of a plan it did not select', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), 'plans/lore.swarm.mjs');
    await session.receive(authFrame(TOKEN));

    const other = { selectedPlan: 'plans/edit.swarm.mjs', briefs: ['not yours'] };
    session.emit('planDetail', other as never);
    expect(topicsOf(port)).toEqual(['hello']);

    const mine = { selectedPlan: 'plans/lore.swarm.mjs', briefs: ['mine'] };
    session.emit('planDetail', mine as never);
    expect(topicsOf(port)).toEqual(['hello', 'planDetail']);
    expect(parseEnvelope(port.sent[1])?.data).toEqual(mine);
  });

  it('receives published slices', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    session.emit('processes', [{ pid: 1, ppid: 0, name: 'node' }]);

    expect(topicsOf(port)).toEqual(['hello', 'processes']);
    expect(parseEnvelope(port.sent[1])?.data).toEqual([{ pid: 1, ppid: 0, name: 'node' }]);
  });

  it('switches plans on the same socket, answering with a fresh hello', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(watchFrame('plans/edit.swarm.mjs'));

    expect(session.watching()).toBe('plans/edit.swarm.mjs');
    expect(topicsOf(port)).toEqual(['hello', 'hello']);
    expect((parseEnvelope(port.sent[1])?.data as PawSnapshot).selectedPlan).toBe(
      'plans/edit.swarm.mjs',
    );
  });

  it('refuses a plan the repository does not hold without dropping the connection', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), 'plans/lore.swarm.mjs');
    await session.receive(authFrame(TOKEN));

    await session.receive(watchFrame('../../etc/passwd'));

    expect(topicsOf(port)).toEqual(['hello', 'error']);
    expect(parseEnvelope(port.sent[1])?.data).toEqual({
      code: 'unknown-plan',
      message: 'no such plan in this repository',
    });
    // It keep watching what it had; refused switch not switch to nothing.
    expect(session.watching()).toBe('plans/lore.swarm.mjs');
    expect(session.state()).toBe('live');
  });

  it('stays open when a plan stops parsing, and says so', async () => {
    const port = fakePort();
    let broken = false;
    const deps = fakeDeps({
      snapshot: async (plan) => {
        if (broken) {
          throw new Error('SyntaxError: unexpected token');
        }
        return snapshotFor(plan);
      },
    });
    const session = createSession(port, deps, fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    broken = true;
    await session.receive(watchFrame('plans/lore.swarm.mjs'));

    // The operator is mid-edit. Dropping the connection on every save of a
    // half-written plan would close the console at the moment it is in use.
    expect(session.state()).toBe('live');
    expect(topicsOf(port)).toEqual(['hello', 'error']);
    expect(parseEnvelope(port.sent[1])?.data).toEqual({
      code: 'snapshot-failed',
      message: 'the daemon could not read that plan — see its terminal',
    });
    // Client told what happened; where it happened stay in terminal.
    expect(port.sent[1]).not.toContain('SyntaxError');
    expect(deps.warnings[0]).toContain('SyntaxError');
  });

  it('accepts a watch for no plan at all', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), 'plans/lore.swarm.mjs');
    await session.receive(authFrame(TOKEN));

    await session.receive(watchFrame(null));

    expect(session.watching()).toBeNull();
    expect((parseEnvelope(port.sent[1])?.data as PawSnapshot).selectedPlan).toBeNull();
  });

  it('closes a second authentication attempt rather than re-authenticating', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await session.receive(authFrame(TOKEN));

    expect(port.closed).toEqual([[CLOSE_MALFORMED, 'already authenticated']]);
  });

  it('closes once however many times it is asked', async () => {
    const port = fakePort();
    const watcher = fakeWatcher();
    const session = createSession(port, fakeDeps(), watcher, null);
    await session.receive(authFrame(TOKEN));

    session.close(CLOSE_SHUTDOWN, 'bye');
    session.close(CLOSE_SHUTDOWN, 'bye again');
    session.close(CLOSE_BACKPRESSURE, 'and again');

    // Second close reach registry would decrement count already decremented,
    // then capacity gate refuse real clients.
    expect(port.closed).toEqual([[CLOSE_SHUTDOWN, 'bye']]);
    expect(watcher.closed).toBe(1);
  });

  it('ignores anything that arrives after it closed', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));
    session.close(CLOSE_SHUTDOWN, 'bye');
    const after = port.sent.length;

    await session.receive(watchFrame(null));
    session.emit('host', {} as never);
    session.tick(999_999);

    expect(port.sent).toHaveLength(after);
    expect(port.closed).toHaveLength(1);
  });

  it('does not send a hello that resolved after the socket closed', async () => {
    const port = fakePort();
    let release: () => void = () => undefined;
    const deps = fakeDeps({
      snapshot: async (plan) => {
        await new Promise<void>((done) => {
          release = done;
        });
        return snapshotFor(plan);
      },
    });
    const session = createSession(port, deps, fakeWatcher(), null);

    const pending = session.receive(authFrame(TOKEN));
    session.close(CLOSE_SHUTDOWN, 'bye');
    release();
    await pending;

    // Snapshot come back to socket nobody hold. Write it be write after close,
    // classic source of crashed shutdown.
    expect(port.sent).toEqual([]);
  });
});

describe('a session that talks too much', () => {
  it('is closed once it passes its message allowance', async () => {
    const port = fakePort();
    const deps = fakeDeps();
    const session = createSession(port, deps, fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    for (let sent = 1; sent < MAX_MESSAGES_PER_WINDOW; sent += 1) {
      await session.receive(watchFrame(null));
    }
    expect(session.state()).toBe('live');

    await session.receive(watchFrame(null));
    expect(port.closed).toEqual([[CLOSE_CAPACITY, 'too many messages']]);
  });

  it('gets its allowance back in the next window', async () => {
    const port = fakePort();
    const deps = fakeDeps();
    const session = createSession(port, deps, fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    for (let sent = 1; sent < MAX_MESSAGES_PER_WINDOW; sent += 1) {
      await session.receive(watchFrame(null));
    }
    deps.at = MESSAGE_WINDOW_MS;
    await session.receive(watchFrame(null));

    expect(session.state()).toBe('live');
  });
});

describe('a session that stopped reading', () => {
  it('is skipped rather than queued for, once its buffer grows', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    port.buffered = BACKPRESSURE_SKIP_BYTES;
    session.emit('processes', []);
    session.emit('processes', []);

    expect(topicsOf(port)).toEqual(['hello']);
    expect(session.state()).toBe('live');
  });

  it('gets the whole state back when it drains, because there is no replay', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    port.buffered = BACKPRESSURE_SKIP_BYTES;
    session.emit('processes', []);

    port.buffered = BACKPRESSURE_RESUME_BYTES + 1;
    session.emit('processes', []);
    expect(topicsOf(port)).toEqual(['hello']);

    port.buffered = 0;
    session.emit('processes', []);
    await Promise.resolve();
    await Promise.resolve();

    expect(topicsOf(port)).toEqual(['hello', 'hello']);
  });

  it('is closed outright once its buffer is beyond saving', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    port.buffered = BACKPRESSURE_CLOSE_BYTES;
    session.emit('processes', []);

    expect(port.closed).toEqual([[CLOSE_BACKPRESSURE, 'client is not reading']]);
  });

  it('is closed once it has been stale too long, even if its buffer stopped growing', async () => {
    const port = fakePort();
    const deps = fakeDeps();
    const session = createSession(port, deps, fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    deps.at = 1000;
    port.buffered = BACKPRESSURE_SKIP_BYTES;
    session.emit('processes', []);

    session.tick(1000 + BACKPRESSURE_STALE_MS - 1);
    expect(session.state()).toBe('live');

    session.tick(1000 + BACKPRESSURE_STALE_MS);
    expect(port.closed).toEqual([[CLOSE_BACKPRESSURE, 'client stopped reading']]);
  });

  it.each([
    ['an Error', new Error('plan stopped parsing'), 'plan stopped parsing'],
    ['a thrown value', 'the plan module vanished', 'the plan module vanished'],
  ])('reports a resync that failed with %s rather than losing it', async (_label, thrown, said) => {
    const port = fakePort();
    let fail = false;
    const deps = fakeDeps({
      snapshot: async (plan) => {
        if (fail) {
          throw thrown;
        }
        return snapshotFor(plan);
      },
    });
    const session = createSession(port, deps, fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    port.buffered = BACKPRESSURE_SKIP_BYTES;
    session.emit('processes', []);
    fail = true;
    port.buffered = 0;
    session.emit('processes', []);
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.warnings).toEqual([`snapshot failed for (no plan): ${said}`]);
    expect(topicsOf(port)).toEqual(['hello', 'error']);
  });

  it('builds one snapshot at a time, however many are asked for at once', async () => {
    const port = fakePort();
    let building = 0;
    let peak = 0;
    const deps = fakeDeps({
      snapshot: async (plan) => {
        building += 1;
        peak = Math.max(peak, building);
        await Promise.resolve();
        building -= 1;
        return snapshotFor(plan);
      },
    });
    const session = createSession(port, deps, fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    // Burst in one TCP segment — every `receive` hit buffer check before first
    // snapshot resolve. No serialisation and daemon build one full snapshot per
    // frame on socket it not reading, a message rate limit with no limit on
    // memory those messages cost. Sized just under allowance, so this measure
    // serialisation, not rate limit that close session first.
    await Promise.all(
      Array.from({ length: MAX_MESSAGES_PER_WINDOW - 1 }, () =>
        session.receive(watchFrame('plans/lore.swarm.mjs')),
      ),
    );

    expect(peak).toBe(1);
    expect(session.state()).toBe('live');
  });

  it('answers the last request when several arrived while one was building', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    await Promise.all([
      session.receive(watchFrame('plans/lore.swarm.mjs')),
      session.receive(watchFrame('plans/edit.swarm.mjs')),
    ]);
    await settle();

    expect(session.watching()).toBe('plans/edit.swarm.mjs');
    const last = parseEnvelope(port.sent.at(-1) ?? '');
    expect(last?.topic).toBe('hello');
    expect((last?.data as PawSnapshot).selectedPlan).toBe('plans/edit.swarm.mjs');
  });

  it('does not send a snapshot to a buffer that filled while it was building', async () => {
    const port = fakePort();
    const deps = fakeDeps({
      snapshot: async (plan) => {
        // Client stop reading during build. Check only before await measure
        // buffer no longer exist.
        port.buffered = BACKPRESSURE_SKIP_BYTES;
        return snapshotFor(plan);
      },
    });
    const session = createSession(port, deps, fakeWatcher(), null);

    await session.receive(authFrame(TOKEN));

    expect(port.sent).toEqual([]);
    expect(session.state()).toBe('live');
  });

  it('does not carry a queued request past a failed build', async () => {
    const port = fakePort();
    let fail = true;
    const deps = fakeDeps({
      snapshot: async (plan) => {
        if (fail) {
          throw new Error('plan stopped parsing');
        }
        return snapshotFor(plan);
      },
    });
    const session = createSession(port, deps, fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));
    expect(topicsOf(port)).toEqual(['error']);

    // Second request arrive while failing build in flight. Carry it and next
    // success send two snapshots, no one.
    fail = false;
    await session.receive(watchFrame('plans/lore.swarm.mjs'));
    await settle();

    expect(topicsOf(port)).toEqual(['error', 'hello']);
  });

  it('does not carry a queued request past a snapshot dropped for backpressure', async () => {
    const port = fakePort();
    let stall = true;
    const deps = fakeDeps({
      snapshot: async (plan) => {
        // Client stops reading while first snapshot build, so that frame drop
        // — and request queued behind it must drop too.
        if (stall) {
          port.buffered = BACKPRESSURE_SKIP_BYTES;
          stall = false;
        }
        return snapshotFor(plan);
      },
    });
    const session = createSession(port, deps, fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));
    expect(port.sent).toEqual([]);

    port.buffered = 0;
    session.emit('processes', []);
    await settle();

    // Exactly one resync on drain. Carried request would send second full
    // snapshot to client just caught up.
    expect(topicsOf(port)).toEqual(['hello']);
  });

  it('does not queue a snapshot for a client that is already not reading', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    port.buffered = BACKPRESSURE_SKIP_BYTES;
    await session.receive(watchFrame('plans/lore.swarm.mjs'));
    await session.receive(watchFrame('plans/edit.swarm.mjs'));

    // Snapshot largest frame this protocol send, client ask one per `watch`.
    // No check and message rate limit bound request count while memory cost
    // stay unbounded.
    expect(topicsOf(port)).toEqual(['hello']);
    expect(session.state()).toBe('live');
  });

  it('does not emit to a session that never authenticated', () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);

    session.emit('host', {} as never);

    expect(port.sent).toEqual([]);
  });
});

describe('the session registry', () => {
  it('counts sessions by what they have proved', async () => {
    const deps = fakeDeps();
    const registry = createSessionRegistry(deps);

    const first = registry.open(fakePort(), null);
    registry.open(fakePort(), null);
    expect(registry.preAuth()).toBe(2);
    expect(registry.live()).toBe(0);

    await first.receive(authFrame(TOKEN));
    expect(registry.preAuth()).toBe(1);
    expect(registry.live()).toBe(1);
  });

  it('forgets a session when it closes, so the count cannot drift', async () => {
    const registry = createSessionRegistry(fakeDeps());
    const session = registry.open(fakePort(), null);
    await session.receive(authFrame(TOKEN));

    session.close(CLOSE_SHUTDOWN, 'bye');

    expect(registry.live()).toBe(0);
    expect(registry.preAuth()).toBe(0);
  });

  it('broadcasts to the live sessions and skips the ones still proving themselves', async () => {
    const registry = createSessionRegistry(fakeDeps());
    const livePort = fakePort();
    const quietPort = fakePort();
    const live = registry.open(livePort, null);
    registry.open(quietPort, null);
    await live.receive(authFrame(TOKEN));

    registry.broadcast('processes', []);

    expect(topicsOf(livePort)).toEqual(['hello', 'processes']);
    expect(quietPort.sent).toEqual([]);
  });

  it('counts refused credentials and tells the operator, without locking anyone out', async () => {
    const deps = fakeDeps();
    const registry = createSessionRegistry(deps);

    for (let attempt = 0; attempt < MAX_AUTH_FAILURES; attempt += 1) {
      await registry.open(fakePort(), null).receive(authFrame('guess'));
    }

    expect(registry.failedAuths()).toBe(MAX_AUTH_FAILURES);
    expect(deps.warnings.join('')).toContain('guessing at the console');
  });

  it('never turns guesses into a lockout, because that lockout is a DoS anyone can trigger', async () => {
    const deps = fakeDeps();
    const registry = createSessionRegistry(deps);

    // On loopback the daemon cannot tell one local peer from another, so a
    // global cooldown would let any local process lock the operator out of
    // their own console against a 256-bit credential, behind a four-socket
    // pre-auth cap.
    for (let attempt = 0; attempt < MAX_AUTH_FAILURES * 3; attempt += 1) {
      await registry.open(fakePort(), null).receive(authFrame('guess'));
    }

    const operator = fakePort();
    await registry.open(operator, null).receive(authFrame(TOKEN));
    expect(topicsOf(operator)).toEqual(['hello']);
  });

  it('does not count a socket that merely went quiet as a guess', async () => {
    const deps = fakeDeps();
    const registry = createSessionRegistry(deps);
    const port = fakePort();
    registry.open(port, null);

    registry.tick(AUTH_TIMEOUT_MS);

    // Silence protocol fail, not attempt at credential — and close code must
    // be one console retry, not one that lock it out.
    expect(registry.failedAuths()).toBe(0);
    expect(port.closed).toEqual([[CLOSE_MALFORMED, 'no credential offered in time']]);
  });

  it('ticks every session', () => {
    const registry = createSessionRegistry(fakeDeps());
    const port = fakePort();
    registry.open(port, null);

    registry.tick(AUTH_TIMEOUT_MS);

    expect(port.closed).toEqual([[CLOSE_MALFORMED, 'no credential offered in time']]);
  });

  it('closes everyone on shutdown, with a code that says why', async () => {
    const registry = createSessionRegistry(fakeDeps());
    const first = fakePort();
    const second = fakePort();
    await registry.open(first, null).receive(authFrame(TOKEN));
    registry.open(second, null);

    registry.shutdown();

    expect(first.closed).toEqual([[CLOSE_SHUTDOWN, 'pawd is shutting down']]);
    expect(second.closed).toEqual([[CLOSE_SHUTDOWN, 'pawd is shutting down']]);
    expect(registry.live()).toBe(0);
  });
});

describe('the deps a session is handed', () => {
  it('never sees the token in anything it sends', async () => {
    const port = fakePort();
    const session = createSession(port, fakeDeps(), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));
    session.emit('processes', []);
    await session.receive(watchFrame(null));

    expect(port.sent.join('')).not.toContain(TOKEN);
    expect(port.closed.map(([, reason]) => reason).join('')).not.toContain(TOKEN);
  });

  it('stamps every frame with the daemon’s own clock', async () => {
    const port = fakePort();
    const clock = vi.fn(() => 1_786_060_800_000);
    const session = createSession(port, fakeDeps({ clock }), fakeWatcher(), null);
    await session.receive(authFrame(TOKEN));

    expect(parseEnvelope(port.sent[0])?.at).toBe(1_786_060_800_000);
    expect(clock).toHaveBeenCalled();
  });
});
