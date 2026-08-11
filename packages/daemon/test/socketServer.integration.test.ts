/**
 * @fileoverview Real-socket test for bind/accept/close path. Client connect over platform pipe or unix socket, do handshake, call method. Second bind on same path refused. Per-connection branch unit-test with fake; this prove transport carry session end to end.
 *
 * @module @paw/daemon/test/socketServer.integration
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRpcSession } from '../src/application/rpcSession.js';
import { socketPath } from '../src/infrastructure/endpoint.js';
import { listenSocket } from '../src/infrastructure/socketServer.js';

const session = () =>
  createRpcSession({
    token: 'T',
    protocolVersion: 1,
    hello: { ok: true },
    methods: { echo: async (p) => p },
  });

const line = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
const CONNECT = line({ jsonrpc: '2.0', id: 1, method: 'connect', params: { token: 'T', protocolVersion: 1 } });
const ECHO = line({ jsonrpc: '2.0', id: 2, method: 'echo', params: { hi: 1 } });

/** Fresh temp root and socket path right for platform. */
function tempEndpoint() {
  const root = mkdtempSync(join(tmpdir(), 'paw-sock-'));
  const path = socketPath(root, { platform: process.platform, xdgRuntimeDir: undefined, tmpdir: root });
  return { root, path };
}

/**
 * Send frames one at time over real client. Wait each response line. Resolve with every line received.
 *
 * @param path - Socket path to connect to.
 * @param frames - Frames to send in order.
 */
function roundtrip(path: string, frames: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const received: string[] = [];
    const client = netConnect(path);
    client.setEncoding('utf8');
    let buffer = '';
    let sent = 0;
    client.on('connect', () => client.write(frames[sent++]));
    client.on('error', reject);
    client.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        received.push(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (sent < frames.length) {
          client.write(frames[sent++]);
        } else {
          client.end();
          resolve(received);
        }
        nl = buffer.indexOf('\n');
      }
    });
  });
}

describe('listenSocket', () => {
  it('carries a handshake and a method call end to end', async () => {
    const { root, path } = tempEndpoint();
    const handle = await listenSocket(path, session);
    try {
      const out = await roundtrip(path, [CONNECT, ECHO]);
      expect(JSON.parse(out[0]).result).toEqual({ ok: true });
      expect(JSON.parse(out[1]).result).toEqual({ hi: 1 });
    } finally {
      await handle.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects binding a path already in use', async () => {
    const { root, path } = tempEndpoint();
    const handle = await listenSocket(path, session);
    try {
      await expect(listenSocket(path, session)).rejects.toBeDefined();
    } finally {
      await handle.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
