/**
 * PAW Console Server Body-Handling Tests
 *
 * @fileoverview The two functions that stand between a socket and the router:
 * `readBody`, which buffers a body and refuses at the cap, and `answerRequest`,
 * which reads a write's body, routes it, and answers — a read never waiting on a
 * stream, an oversized body a 413 the router never sees, a thrown error a silent
 * 500. Driven with a fake request stream and a fake response so every arm is
 * covered without binding a socket.
 *
 * @module @paw/daemon/test/consoleServer
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, HttpResponse } from '../src/domain/router.js';
import { CONTROL_BODY_CAP } from '../src/domain/control.js';
import { answerRequest, readBody } from '../src/infrastructure/http/consoleServer.js';

/**
 * A fake request: an async-iterable body plus the fields `toRequest` reads.
 *
 * @param method - The HTTP method.
 * @param opts - The url, headers, and body chunks.
 */
function fakeReq(
  method: string | undefined,
  opts: { url?: string; headers?: Record<string, string>; chunks?: (Buffer | string)[] } = {},
): IncomingMessage {
  const chunks = opts.chunks ?? [];
  return {
    method,
    url: opts.url ?? '/api/thing',
    headers: opts.headers ?? {},
    async *[Symbol.asyncIterator](): AsyncIterator<Buffer | string> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  } as unknown as IncomingMessage;
}

/** A fake response that records what was written to it. */
function fakeRes(): ServerResponse & { sent: { status: number; headers: unknown; body: string } } {
  const sent = { status: 0, headers: {} as unknown, body: '' };
  return {
    sent,
    writeHead(status: number, headers: unknown): void {
      sent.status = status;
      sent.headers = headers;
    },
    end(body?: string): void {
      sent.body = body ?? '';
    },
  } as unknown as ServerResponse & { sent: typeof sent };
}

/**
 * Feed an array of chunks as an async iterable.
 *
 * @param chunks - The chunks to yield.
 */
async function* stream(...chunks: (Buffer | string)[]): AsyncIterable<Buffer | string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

const HOST = '127.0.0.1:8971';

describe('readBody', () => {
  it('concatenates string and buffer chunks into utf8', async () => {
    const read = await readBody(stream('{"a":', Buffer.from('1}')), CONTROL_BODY_CAP);
    expect(read).toEqual({ ok: true, body: '{"a":1}' });
  });

  it('reads an empty stream as the empty string', async () => {
    expect(await readBody(stream(), CONTROL_BODY_CAP)).toEqual({ ok: true, body: '' });
  });

  it('refuses a body past the cap without buffering the rest', async () => {
    const over = Buffer.alloc(CONTROL_BODY_CAP + 1, 0x61);
    expect(await readBody(stream(over), CONTROL_BODY_CAP)).toEqual({ ok: false });
  });
});

describe('answerRequest', () => {
  const ok: HttpResponse = { status: 200, headers: { 'x-test': '1' }, body: 'routed' };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a read without waiting on a body, writing what the router returned', async () => {
    const res = fakeRes();
    const handler = vi.fn(async (_request: HttpRequest) => ok);
    await answerRequest(fakeReq('GET', { url: '/api/state' }), res, HOST, handler);
    expect(res.sent).toEqual({ status: 200, headers: { 'x-test': '1' }, body: 'routed' });
    expect(handler.mock.calls[0][0].body).toBeUndefined();
  });

  it('reads a write’s body and hands it to the router', async () => {
    const res = fakeRes();
    const handler = vi.fn(async (_request: HttpRequest) => ok);
    await answerRequest(
      fakeReq('POST', { chunks: ['{"n":2}'], headers: { 'content-type': 'application/json' } }),
      res,
      HOST,
      handler,
    );
    const seen = handler.mock.calls[0][0];
    expect(seen.body).toBe('{"n":2}');
    expect(seen.headers?.contentType).toBe('application/json');
    expect(res.sent.status).toBe(200);
  });

  it('answers 413 for a body past the cap, never reaching the router', async () => {
    const res = fakeRes();
    const handler = vi.fn(async () => ok);
    await answerRequest(
      fakeReq('PUT', { chunks: [Buffer.alloc(CONTROL_BODY_CAP + 1, 0x61)] }),
      res,
      HOST,
      handler,
    );
    expect(res.sent.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it('treats a request with no method as a read, not a write', async () => {
    const res = fakeRes();
    const handler = vi.fn(async (_request: HttpRequest) => ok);
    await answerRequest(fakeReq(undefined), res, HOST, handler);
    expect(handler.mock.calls[0][0].body).toBeUndefined();
    expect(res.sent.status).toBe(200);
  });

  it('answers a silent 500 when the router throws, and reports it to stderr', async () => {
    const res = fakeRes();
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await answerRequest(fakeReq('GET'), res, HOST, async () => {
      throw new Error('disk on fire');
    });
    expect(res.sent.status).toBe(500);
    expect(res.sent.body).toBe('internal error');
    expect(err).toHaveBeenCalledOnce();
    expect(String(err.mock.calls[0][0])).toContain('disk on fire');
  });
});
