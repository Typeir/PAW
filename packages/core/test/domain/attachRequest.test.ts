/**
 * PAW Attach Request Tests
 *
 * @fileoverview Cover attach message. Daemon record request, operator approve
 * elsewhere. Pin parsing discipline — allow-list rebuild message, refuse thing
 * no recognise, refuse mode outside three domain define.
 *
 * @module @paw/core/test/domain/attachRequest
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { encodeAttach, parseClientMessage } from '../../src/domain/liveWire.js';

describe('encodeAttach', () => {
  it('round-trips through the parser', () => {
    expect(parseClientMessage(encodeAttach('/repo/thing', 'merge'))).toEqual({
      v: 1,
      type: 'attach',
      path: '/repo/thing',
      mode: 'merge',
    });
  });

  it('travels in the compact wire form like every other frame', () => {
    const frame = JSON.parse(encodeAttach('/repo', 'create')) as Record<string, unknown>;
    expect(frame.m).toBe('t');
    expect(Object.keys(frame).sort()).toEqual(['d', 'm', 'p', 'v']);
  });
});

describe('parseClientMessage — attach', () => {
  it('accepts each mode the domain defines', () => {
    for (const mode of ['create', 'merge', 'override'] as const) {
      expect(parseClientMessage(encodeAttach('/repo', mode))).toEqual({
        v: 1,
        type: 'attach',
        path: '/repo',
        mode,
      });
    }
  });

  it('refuses a mode outside that set', () => {
    expect(parseClientMessage('{"v":1,"m":"t","p":"/repo","d":"delete"}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"t","p":"/repo","d":""}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"t","p":"/repo"}')).toBeNull();
  });

  it('refuses a missing or empty path, which no operator could approve', () => {
    expect(parseClientMessage('{"v":1,"m":"t","d":"merge"}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"t","p":"","d":"merge"}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"t","p":123,"d":"merge"}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"t","p":null,"d":"merge"}')).toBeNull();
  });

  it('rebuilds the message rather than passing the parsed object through', () => {
    const parsed = parseClientMessage(
      '{"v":1,"m":"t","p":"/repo","d":"merge","exec":"rm -rf /","__proto__":{"x":1}}',
    );
    expect(parsed).toEqual({ v: 1, type: 'attach', path: '/repo', mode: 'merge' });
    expect(Object.keys(parsed ?? {})).toEqual(['v', 'type', 'path', 'mode']);
  });

  it('refuses the spelled-out form, so there is one dialect', () => {
    expect(
      parseClientMessage('{"v":1,"type":"attach","path":"/repo","mode":"merge"}'),
    ).toBeNull();
  });

  it('refuses the wrong protocol version', () => {
    expect(parseClientMessage('{"v":2,"m":"t","p":"/repo","d":"merge"}')).toBeNull();
  });

  it('refuses a frame beyond the size cap, path included', () => {
    expect(parseClientMessage(encodeAttach('/'.padEnd(5000, 'x'), 'merge'))).toBeNull();
  });
});
