/**
 * @fileoverview Test pawd RPC wire. Pin NDJSON framing, allow-list parser across
 * every frame kind and malformed shape, and builders. Drive `rpcWire.ts` to 100%.
 * Parser accept only the envelope fields it name.
 *
 * @module @paw/core/test/domain/rpcWire
 */

import { describe, expect, it } from 'vitest';
import {
  RPC_ERROR,
  RPC_PROTOCOL_VERSION,
  encodeFrame,
  parseFrame,
  rpcFailure,
  rpcNotification,
  rpcRequest,
  rpcSuccess,
  splitFrames,
} from '../../src/index.js';

describe('encodeFrame + splitFrames', () => {
  it('encodes a frame as one newline-terminated line', () => {
    const line = encodeFrame(rpcRequest(1, 'hook.preToolUse', { toolName: 'edit' }));
    expect(line.endsWith('\n')).toBe(true);
    expect(line).not.toContain('\n\n');
  });

  it('splits complete lines and keeps the trailing partial', () => {
    const { lines, rest } = splitFrames('{"a":1}\n{"b":2}\n{"c":3');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('{"c":3');
  });

  it('returns no lines when there is no terminator yet', () => {
    expect(splitFrames('{"a":1}')).toEqual({ lines: [], rest: '{"a":1}' });
  });
});

describe('parseFrame — allow-list', () => {
  it('parses a request, copying only the envelope fields', () => {
    const frame = parseFrame('{"jsonrpc":"2.0","id":7,"method":"hook.postToolUse","params":{"x":1},"extra":"drop"}');
    expect(frame).toEqual({ jsonrpc: '2.0', id: 7, method: 'hook.postToolUse', params: { x: 1 } });
    expect(frame && 'extra' in frame).toBe(false);
  });

  it('parses a notification (method, no id)', () => {
    expect(parseFrame('{"jsonrpc":"2.0","method":"event","params":{"type":"violation.raised"}}')).toEqual({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'violation.raised' },
    });
  });

  it('parses a success', () => {
    expect(parseFrame('{"jsonrpc":"2.0","id":2,"result":{"decision":"allow"}}')).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { decision: 'allow' },
    });
  });

  it('parses a failure with data', () => {
    expect(parseFrame('{"jsonrpc":"2.0","id":3,"error":{"code":-32001,"message":"old","data":{"need":2}}}')).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32001, message: 'old', data: { need: 2 } },
    });
  });

  it('parses a failure without data', () => {
    const frame = parseFrame('{"jsonrpc":"2.0","id":3,"error":{"code":-32002,"message":"starting"}}');
    expect(frame).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32002, message: 'starting' } });
    expect(frame && 'error' in frame && 'data' in frame.error).toBe(false);
  });

  it('rejects malformed JSON', () => {
    expect(parseFrame('{not json')).toBeNull();
  });

  it('rejects a non-object frame', () => {
    expect(parseFrame('42')).toBeNull();
    expect(parseFrame('null')).toBeNull();
  });

  it('rejects a frame with the wrong protocol tag', () => {
    expect(parseFrame('{"jsonrpc":"1.0","id":1,"method":"x"}')).toBeNull();
  });

  it('rejects an id-only frame that is neither result nor error', () => {
    expect(parseFrame('{"jsonrpc":"2.0","id":9}')).toBeNull();
  });
});

describe('builders + constants', () => {
  it('builds a success and a notification', () => {
    expect(rpcSuccess(5, { ok: true })).toEqual({ jsonrpc: '2.0', id: 5, result: { ok: true } });
    expect(rpcNotification('event', { t: 1 })).toEqual({ jsonrpc: '2.0', method: 'event', params: { t: 1 } });
  });

  it('builds a failure with and without data', () => {
    expect(rpcFailure(1, RPC_ERROR.methodNotFound, 'nope')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'nope' },
    });
    expect(rpcFailure(1, RPC_ERROR.internal, 'boom', { at: 'x' }).error.data).toEqual({ at: 'x' });
  });

  it('exposes the protocol version', () => {
    expect(RPC_PROTOCOL_VERSION).toBe(1);
  });
});
