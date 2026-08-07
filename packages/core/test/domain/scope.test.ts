/**
 * PAW Scope Tests
 *
 * @fileoverview Covers pointing an unscoped daemon at a repository. Scoping is
 * a *read* — it changes what the daemon looks at, exactly as `watch` changes
 * which plan it reports — so it needs no approval, and what has to be pinned
 * instead is its ceiling: a console may name a directory beneath the operator's
 * home and nothing above or outside it.
 *
 * @module @paw/core/test/domain/scope
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { encodeScope, parseClientMessage } from '../../src/domain/liveWire.js';
import { withinRoot } from '../../src/domain/scope.js';

describe('encodeScope', () => {
  it('round-trips through the parser', () => {
    expect(parseClientMessage(encodeScope('/home/x/work/thing'))).toEqual({
      v: 1,
      type: 'scope',
      path: '/home/x/work/thing',
    });
  });

  it('rebuilds the message rather than passing the parsed object through', () => {
    const parsed = parseClientMessage('{"v":1,"m":"r","p":"/home/x","admin":true}');
    expect(parsed).toEqual({ v: 1, type: 'scope', path: '/home/x' });
    expect(Object.keys(parsed ?? {})).toEqual(['v', 'type', 'path']);
  });

  it('refuses a missing, empty or non-string path', () => {
    expect(parseClientMessage('{"v":1,"m":"r"}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"r","p":""}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"r","p":null}')).toBeNull();
    expect(parseClientMessage('{"v":1,"m":"r","p":42}')).toBeNull();
  });
});

describe('withinRoot', () => {
  it('accepts the root itself and anything beneath it', () => {
    expect(withinRoot('/home/x', '/home/x')).toBe(true);
    expect(withinRoot('/home/x/work/thing', '/home/x')).toBe(true);
  });

  it('refuses anything above or beside the root', () => {
    expect(withinRoot('/home', '/home/x')).toBe(false);
    expect(withinRoot('/home/y', '/home/x')).toBe(false);
    expect(withinRoot('/', '/home/x')).toBe(false);
  });

  it('refuses a sibling whose name merely shares the root’s prefix', () => {
    expect(withinRoot('/home/xyz', '/home/x')).toBe(false);
  });

  it('resolves traversal rather than matching on the raw string', () => {
    expect(withinRoot('/home/x/work/../..', '/home/x')).toBe(false);
    expect(withinRoot('/home/x/work/../other', '/home/x')).toBe(true);
    expect(withinRoot('/home/x/../../etc', '/home/x')).toBe(false);
  });

  it('treats both separators alike, so a Windows console cannot sidestep it', () => {
    expect(withinRoot('C:\\Users\\x\\work', 'C:/Users/x')).toBe(true);
    expect(withinRoot('C:\\Users\\x\\..\\y', 'C:/Users/x')).toBe(false);
  });

  it('ignores a trailing separator on either side', () => {
    expect(withinRoot('/home/x/work/', '/home/x/')).toBe(true);
    expect(withinRoot('/home/x/', '/home/x')).toBe(true);
  });

  it('refuses an empty candidate or an empty root rather than defaulting open', () => {
    expect(withinRoot('', '/home/x')).toBe(false);
    expect(withinRoot('/home/x', '')).toBe(false);
  });
});
