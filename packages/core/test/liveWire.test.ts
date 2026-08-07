/**
 * Live Wire Protocol Tests
 *
 * @fileoverview Mostly a parser suite, and mostly about refusal. Everything that
 * reaches `parseClientMessage` came off a socket that anything on the machine
 * could have opened, so the tests are written the way an attacker would write
 * them: prototype keys, arrays where objects belong, right shape with the wrong
 * version, oversize frames, and fields of the wrong type.
 *
 * The other half is the contract itself — close codes must stay distinct and
 * stable, because a console distinguishes "your token is wrong, stop retrying"
 * from "too busy, come back" by nothing else.
 *
 * @module @paw/core/test/liveWire
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import {
  BACKPRESSURE_CLOSE_BYTES,
  BACKPRESSURE_RESUME_BYTES,
  BACKPRESSURE_SKIP_BYTES,
  CLIENT_SILENCE_MS,
  CLOSE_AUTH,
  CLOSE_BACKPRESSURE,
  CLOSE_CAPACITY,
  CLOSE_MALFORMED,
  CLOSE_ORIGIN,
  CLOSE_SHUTDOWN,
  LIVE_SUBPROTOCOL,
  LIVE_TOPICS,
  LIVE_VERSION,
  MAX_AUTH_FAILURES,
  MAX_FRAME_BYTES,
  MAX_PREAUTH_SESSIONS,
  MAX_SESSIONS,
  PING_MS,
  PONG_TIMEOUT_MS,
  TOPIC_CODES,
  authFrame,
  encodeEnvelope,
  isLiveTopic,
  parseClientMessage,
  parseEnvelope,
  topicOfCode,
  watchFrame,
} from '../src/domain/liveWire.js';

describe('the wire form', () => {
  it('spends its bytes on payload, not on framing', () => {
    const frame = encodeEnvelope('host', { pid: 1 } as never, 1786060800000);
    expect(frame).toBe('{"v":1,"t":"ho","a":1786060800000,"d":{"pid":1}}');

    // The same frame spelled out. The host slice ticks once a second per open
    // console, so this difference is paid thousands of times an hour.
    const spelled = JSON.stringify({
      v: 1,
      topic: 'host',
      at: new Date(1786060800000).toISOString(),
      data: { pid: 1 },
    });
    // 23 bytes on this frame — and the saving is per frame, not per session.
    expect(spelled.length - frame.length).toBeGreaterThanOrEqual(20);
  });

  it('keeps client frames atomic too', () => {
    expect(authFrame('t0ken')).toBe('{"v":1,"m":"a","k":"t0ken"}');
    expect(watchFrame('plans/lore.swarm.mjs')).toBe(
      '{"v":1,"m":"w","p":"plans/lore.swarm.mjs"}',
    );
    expect(watchFrame(null)).toBe('{"v":1,"m":"w","p":null}');
  });

  it('gives every topic a distinct two-character code', () => {
    const codes = LIVE_TOPICS.map((topic) => TOPIC_CODES[topic]);
    expect(codes).toHaveLength(LIVE_TOPICS.length);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toHaveLength(2);
    }
  });

  it('round-trips every topic through its code', () => {
    for (const topic of LIVE_TOPICS) {
      expect(topicOfCode(TOPIC_CODES[topic])).toBe(topic);
    }
  });

  it('refuses a code it does not know, and anything that is not one', () => {
    expect(topicOfCode('zz')).toBeNull();
    expect(topicOfCode('host')).toBeNull();
    expect(topicOfCode('')).toBeNull();
    expect(topicOfCode(undefined)).toBeNull();
    expect(topicOfCode(7)).toBeNull();
    expect(topicOfCode(null)).toBeNull();
  });

  it('exposes every topic the map declares, so none can travel unencoded', () => {
    expect(LIVE_TOPICS).toContain('hello');
    expect(LIVE_TOPICS).toContain('planDetail');
    expect(LIVE_TOPICS).toContain('error');
    expect(Object.keys(TOPIC_CODES)).toEqual([...LIVE_TOPICS]);
  });
});

describe('the protocol’s constants', () => {
  it('names a versioned subprotocol, so a future version cannot be mistaken for this one', () => {
    expect(LIVE_SUBPROTOCOL).toBe('paw.live.v1');
    expect(LIVE_VERSION).toBe(1);
  });

  it('keeps every close code distinct', () => {
    const codes = [
      CLOSE_MALFORMED,
      CLOSE_AUTH,
      CLOSE_ORIGIN,
      CLOSE_CAPACITY,
      CLOSE_BACKPRESSURE,
      CLOSE_SHUTDOWN,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses the application range for its own codes and the standard range for the standard ones', () => {
    for (const code of [CLOSE_MALFORMED, CLOSE_AUTH, CLOSE_ORIGIN, CLOSE_CAPACITY]) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
    expect(CLOSE_BACKPRESSURE).toBe(1013);
    expect(CLOSE_SHUTDOWN).toBe(1001);
  });

  it('sets limits that leave room for a real frame and none for an attack', () => {
    expect(authFrame('a'.repeat(64)).length).toBeLessThan(MAX_FRAME_BYTES);
    expect(MAX_PREAUTH_SESSIONS).toBeLessThan(MAX_SESSIONS);
    expect(PONG_TIMEOUT_MS).toBeLessThan(PING_MS);
    expect(CLIENT_SILENCE_MS).toBeGreaterThan(1000);
    expect(MAX_AUTH_FAILURES).toBeGreaterThan(0);
  });

  it('orders the backpressure thresholds so a session can drain before it is closed', () => {
    expect(BACKPRESSURE_RESUME_BYTES).toBeLessThan(BACKPRESSURE_SKIP_BYTES);
    expect(BACKPRESSURE_SKIP_BYTES).toBeLessThan(BACKPRESSURE_CLOSE_BYTES);
  });
});

describe('isLiveTopic', () => {
  it('accepts every topic the map declares', () => {
    for (const topic of LIVE_TOPICS) {
      expect(isLiveTopic(topic)).toBe(true);
    }
    expect(LIVE_TOPICS).toContain('hello');
    expect(LIVE_TOPICS).toContain('planDetail');
  });

  it('refuses anything else, including the shapes that are not strings', () => {
    expect(isLiveTopic('Host')).toBe(false);
    expect(isLiveTopic('')).toBe(false);
    expect(isLiveTopic('constructor')).toBe(false);
    expect(isLiveTopic(undefined)).toBe(false);
    expect(isLiveTopic(null)).toBe(false);
    expect(isLiveTopic(1)).toBe(false);
    expect(isLiveTopic({ topic: 'host' })).toBe(false);
  });
});

describe('parseClientMessage', () => {
  it('reads the two messages the daemon accepts', () => {
    expect(parseClientMessage(authFrame('secret'))).toEqual({
      v: 1,
      type: 'auth',
      token: 'secret',
    });
    expect(parseClientMessage(watchFrame('plans/lore.swarm.mjs'))).toEqual({
      v: 1,
      type: 'watch',
      plan: 'plans/lore.swarm.mjs',
    });
    expect(parseClientMessage(watchFrame(null))).toEqual({ v: 1, type: 'watch', plan: null });
  });

  it('rebuilds the message rather than passing the parsed object through', () => {
    const parsed = parseClientMessage(
      '{"v":1,"m":"a","k":"secret","admin":true,"__proto__":{"x":1}}',
    );
    // Everything unrecognised is dropped on the floor. A validator that returned
    // the caller's object would carry `admin` into the daemon.
    expect(parsed).toEqual({ v: 1, type: 'auth', token: 'secret' });
    expect(Object.keys(parsed ?? {})).toEqual(['v', 'type', 'token']);
  });

  it('refuses a frame that is not a JSON object', () => {
    expect(parseClientMessage('')).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage('"a"')).toBeNull();
    expect(parseClientMessage('42')).toBeNull();
    expect(parseClientMessage('[{"v":1,"m":"a","k":"x"}]')).toBeNull();
  });

  it('refuses the wrong version, so a future client cannot be half-understood', () => {
    expect(parseClientMessage('{"v":2,"m":"a","k":"x"}')).toBeNull();
    expect(parseClientMessage('{"m":"a","k":"x"}')).toBeNull();
    expect(parseClientMessage('{"v":"1","m":"a","k":"x"}')).toBeNull();
  });

  it('refuses an unknown message code, including the spelled-out form', () => {
    expect(parseClientMessage('{"v":1,"m":"s","t":"ho"}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"eval","c":"1"}')).toBeNull();
    // The long form is not a second accepted dialect: one wire form, or the
    // parser becomes two parsers that drift.
    expect(parseClientMessage('{"v":1,"type":"auth","token":"x"}')).toBeNull();
    expect(parseClientMessage('{"v":1}')).toBeNull();
  });

  it('refuses a token that is not a non-empty string', () => {
    expect(parseClientMessage('{"v":1,"m":"a"}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"a","k":""}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"a","k":null}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"a","k":123}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"a","k":["x"]}')).toBeNull();
  });

  it('refuses a plan that is neither a string nor null', () => {
    expect(parseClientMessage('{"v":1,"m":"w"}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"w","p":7}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"w","p":{}}')).toBeNull();
  });

  it('refuses an oversize frame before it parses it', () => {
    const huge = authFrame('a'.repeat(MAX_FRAME_BYTES));
    expect(huge.length).toBeGreaterThan(MAX_FRAME_BYTES);
    expect(parseClientMessage(huge)).toBeNull();
  });
});

describe('encodeEnvelope and parseEnvelope', () => {
  it('round-trips a frame, decoding the code back to a readable topic', () => {
    const frame = encodeEnvelope('error', { code: 'unknown-plan', message: 'no' }, 1786060800000);
    expect(parseEnvelope(frame)).toEqual({
      v: 1,
      topic: 'error',
      at: 1786060800000,
      data: { code: 'unknown-plan', message: 'no' },
    });
  });

  it('round-trips every topic, so none is encodable but not decodable', () => {
    for (const topic of LIVE_TOPICS) {
      expect(parseEnvelope(encodeEnvelope(topic, null as never, 1))?.topic).toBe(topic);
    }
  });

  it('carries an empty payload through, because some slices are legitimately empty', () => {
    const frame = encodeEnvelope('plans', { plans: [], configPath: '' }, 1);
    expect(parseEnvelope(frame)?.data).toEqual({ plans: [], configPath: '' });
  });

  it('refuses a frame whose code the console has no arm for', () => {
    expect(parseEnvelope('{"v":1,"t":"zz","a":1,"d":{}}')).toBeNull();
    expect(parseEnvelope('{"v":1,"t":"host","a":1,"d":{}}')).toBeNull();
    expect(parseEnvelope('{"v":1,"a":1,"d":{}}')).toBeNull();
  });

  it('refuses a frame missing its version, timestamp, or payload', () => {
    expect(parseEnvelope('{"v":2,"t":"ho","a":1,"d":{}}')).toBeNull();
    expect(parseEnvelope('{"v":1,"t":"ho","d":{}}')).toBeNull();
    expect(parseEnvelope('{"v":1,"t":"ho","a":"now","d":{}}')).toBeNull();
    expect(parseEnvelope('{"v":1,"t":"ho","a":1}')).toBeNull();
  });

  it('refuses anything that is not a JSON object', () => {
    expect(parseEnvelope('nope')).toBeNull();
    expect(parseEnvelope('[]')).toBeNull();
    expect(parseEnvelope('null')).toBeNull();
  });
});
