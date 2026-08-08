/**
 * @fileoverview End-to-end proof that pawd serves the enforcement loop over a
 * real socket. A client handshakes and drives `hook.dispatch` through the whole
 * cycle against a REAL store and a REAL warm gate cache over a written-out
 * project: a bad edit blocks, the violation denies other files but allows the
 * violated one, fixing it clears, the gate reopens. The connector is an inline
 * fake (the daemon does not depend on @paw/connectors; the copilot one is proven
 * in the cli tier); the store, gate cache, session, dispatch, and transport are
 * all real. Malformed dispatches exercise the param allow-list.
 *
 * @module @paw/daemon/test/serveEnforcement.integration
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateCache, createMemoryStore } from '@paw/adapters';
import type { DispatchHookDeps, HostConnector, PawEvent } from '@paw/core';
import { socketPath } from '../src/infrastructure/endpoint.js';
import { serveEnforcement } from '../src/application/serveEnforcement.js';
import type { SocketServerHandle } from '../src/infrastructure/socketServer.js';

const NO_BAD = `export const gate = {
  id: 'no-bad', name: 'No BADCODE', port: 'code-quality', severity: 'critical', appliesTo: ['.ts'],
  async check(ctx) {
    const findings = [];
    for (const file of await ctx.targetFiles(['.ts'])) {
      if ((await ctx.readFile(file)).includes('BADCODE')) findings.push({ file, rule: 'no-bad', message: 'BADCODE present' });
    }
    return { gate: 'no-bad', passed: findings.length === 0, severity: 'critical', findings, stats: { filesChecked: 1, findingsCount: findings.length, durationMs: 0 } };
  },
};
`;

const testConnector: HostConnector = {
  name: 'test',
  eventName: (type) => (type === 'tool.pre' ? 'PRE' : type === 'tool.post' ? 'POST' : null),
  toEvent: (raw): PawEvent | null => {
    const r = raw as { hookEventName?: string; paths?: string[] };
    const paths = r.paths ?? [];
    if (r.hookEventName === 'PRE') return { type: 'tool.pre', sessionId: 'S', toolName: 'edit', targetPaths: paths, envMatch: null };
    if (r.hookEventName === 'POST') return { type: 'tool.post', sessionId: 'S', toolName: 'edit', editedPaths: paths, failed: false };
    return null;
  },
  fromResponse: (resp) =>
    resp.kind === 'deny' || resp.kind === 'block' ? { kind: resp.kind, reason: resp.reason } : { kind: resp.kind },
};

let root: string;
let handle: SocketServerHandle;
let endpoint: string;

/** A client that sends one frame and resolves with the next response line. */
function open(pathName: string) {
  const c = netConnect(pathName);
  c.setEncoding('utf8');
  let buffer = '';
  const waiters: ((line: string) => void)[] = [];
  c.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      waiters.shift()?.(line);
      nl = buffer.indexOf('\n');
    }
  });
  const ready = new Promise<void>((r) => c.on('connect', () => r()));
  const send = (id: number, method: string, params: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => {
      waiters.push((line) => resolve(JSON.parse(line) as Record<string, unknown>));
      c.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  return { ready, send, close: () => c.end() };
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'paw-serve-'));
  mkdirSync(path.join(root, '.paw', 'gates'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, '.paw', 'gates', 'no-bad.gate.mjs'), NO_BAD);
  writeFileSync(path.join(root, 'src', 'x.ts'), 'export const x = 1; // BADCODE\n');
  writeFileSync(path.join(root, 'src', 'other.ts'), 'export const y = 2;\n');

  const deps: DispatchHookDeps = {
    store: createMemoryStore(),
    gates: createGateCache(root),
    exemptTools: new Set(['read_file']),
    isIgnored: () => false,
    connectors: { test: testConnector },
  };
  endpoint = socketPath(root, { platform: process.platform, xdgRuntimeDir: undefined, tmpdir: root });
  handle = await serveEnforcement({
    socketPath: endpoint,
    projectRoot: root,
    configure: async () => ({ token: 'T', deps }),
  });
});

afterAll(async () => {
  await handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe('pawd enforcement over a real socket', () => {
  it('handshakes, then blocks a bad edit and gates the rest until fixed', async () => {
    const c = open(endpoint);
    await c.ready;

    const hello = await c.send(1, 'connect', { token: 'T', protocolVersion: 1 });
    expect((hello.result as { health: string }).health).toBe('ok');

    const dispatch = (id: number, event: string, file: string) =>
      c.send(id, 'hook.dispatch', { host: 'test', event, payload: { paths: [file] } });

    expect((await dispatch(2, 'tool.post', 'src/x.ts')).result).toMatchObject({ kind: 'block' });
    expect((await dispatch(3, 'tool.pre', 'src/other.ts')).result).toMatchObject({ kind: 'deny' });
    expect((await dispatch(4, 'tool.pre', 'src/x.ts')).result).toEqual({ kind: 'allow' });

    writeFileSync(path.join(root, 'src', 'x.ts'), 'export const x = 1;\n');
    expect((await dispatch(5, 'tool.post', 'src/x.ts')).result).toEqual({ kind: 'noop' });
    expect((await dispatch(6, 'tool.pre', 'src/other.ts')).result).toEqual({ kind: 'allow' });

    c.close();
  });

  it('answers a malformed dispatch with a bare continue', async () => {
    const c = open(endpoint);
    await c.ready;
    await c.send(1, 'connect', { token: 'T', protocolVersion: 1 });

    const bad = (id: number, params: unknown) => c.send(id, 'hook.dispatch', params);
    expect((await bad(2, { host: 'test', event: 'bogus', payload: {} })).result).toEqual({ continue: true });
    expect((await bad(3, { host: 5, event: 'tool.pre', payload: {} })).result).toEqual({ continue: true });
    expect((await bad(4, { host: 'test', event: 5, payload: {} })).result).toEqual({ continue: true });
    expect((await bad(5, { host: 'test', event: 'tool.pre', payload: 'not-object' })).result).toEqual({ kind: 'allow' });
    expect((await bad(6, null)).result).toEqual({ continue: true });

    c.close();
  });

  it('releases the claim and rejects when configure fails', async () => {
    const other = mkdtempSync(path.join(tmpdir(), 'paw-serve-fail-'));
    const sock = socketPath(other, { platform: process.platform, xdgRuntimeDir: undefined, tmpdir: other });
    await expect(
      serveEnforcement({
        socketPath: sock,
        projectRoot: other,
        configure: async () => {
          throw new Error('store unavailable');
        },
      }),
    ).rejects.toThrow('store unavailable');
    rmSync(other, { recursive: true, force: true });
  });
});
