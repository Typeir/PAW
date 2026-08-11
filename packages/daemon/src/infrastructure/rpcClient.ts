/**
 * PAW daemon client.
 *
 * @fileoverview One JSON-RPC round trip to resident daemon, plus fail-open rule
 * that make hook safe (doc 10 §7): read handshake token, connect, `connect` then
 * method, resolve result. ANY failure — no token, no socket, reset, timeout,
 * malformed frame, error frame — resolve null, caller write host do-nothing
 * output instead. No daemon failure can break the hook.
 *
 * Live in daemon package beside endpoint addressing and RPC wire so every driving
 * adapter — cli, tui — share one client. `connect` and `readToken` inject so every
 * branch test without pipe.
 *
 * @module @paw/daemon/rpcClient
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { readFileSync } from 'node:fs';
import { connect as netConnect, type Socket } from 'node:net';
import {
  RPC_PROTOCOL_VERSION,
  encodeFrame,
  parseFrame,
  rpcRequest,
  splitFrames,
} from '@paw/core';

/**
 * Give-up deadline for daemon round trip. A `tool.post` run project's real gates
 * inside pawd — first run compile gate modules and one shell out to `tsc`, so 2s
 * failed open on real repo while block still compute. Sized to sit under tightest
 * host hook budget (pre-tool, ~10s) so client still fail open before host kill
 * hook, never after.
 */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Injectable seam for testing.
 *
 * @interface RpcCallDeps
 * @property {(path: string) => Socket} [connect] - Open socket; default `node:net`.
 * @property {(path: string) => string} [readToken] - Read handshake token; default read file.
 * @property {number} [timeoutMs] - Give-up deadline; default 8s.
 */
export interface RpcCallDeps {
  connect?: (path: string) => Socket;
  readToken?: (path: string) => string;
  timeoutMs?: number;
}

/**
 * Call one method on daemon, resolve result, or null on any failure.
 *
 * @param {string} socketPath - Daemon endpoint.
 * @param {string} tokenPath - Handshake token file.
 * @param {string} method - Method to call after handshake.
 * @param {unknown} params - Method parameters.
 * @param {RpcCallDeps} [deps] - Injectable seam.
 * @returns {Promise<unknown | null>} Result, or null when anything go wrong.
 */
export function rpcCall(
  socketPath: string,
  tokenPath: string,
  method: string,
  params: unknown,
  deps: RpcCallDeps = {},
): Promise<unknown | null> {
  return new Promise((resolve) => {
    let token: string;
    try {
      token = (deps.readToken ?? ((p) => readFileSync(p, 'utf8').trim()))(tokenPath);
    } catch {
      resolve(null);
      return;
    }

    const socket = (deps.connect ?? netConnect)(socketPath);
    let settled = false;
    const finish = (value: unknown | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    let buffer = '';
    let stage: 'connect' | 'call' = 'connect';
    socket.setEncoding('utf8');
    socket.on('error', () => finish(null));
    socket.on('connect', () => {
      socket.write(
        encodeFrame(
          rpcRequest(1, 'connect', {
            token,
            protocolVersion: RPC_PROTOCOL_VERSION,
            client: { kind: 'hook', pid: process.pid },
          }),
        ),
      );
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const split = splitFrames(buffer);
      buffer = split.rest;
      for (const line of split.lines) {
        const frame = parseFrame(line);
        if (frame === null || 'error' in frame) {
          finish(null);
          return;
        }
        if ('result' in frame) {
          if (stage === 'connect') {
            stage = 'call';
            socket.write(encodeFrame(rpcRequest(2, method, params)));
          } else {
            finish(frame.result);
            return;
          }
        }
      }
    });
  });
}
