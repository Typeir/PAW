/**
 * PAW Daemon Client
 *
 * @fileoverview One JSON-RPC round trip to the resident daemon, and the fail-open
 * rule that makes hooks safe (doc 10 §7): read the handshake token, connect,
 * `connect` then the method, resolve the result. ANY failure — no token, no
 * socket, a reset, a timeout, a malformed frame, an error frame — resolves to
 * null, and the caller writes the host's do-nothing output instead. No hook can
 * be bricked by a daemon problem, which is the whole reason enforcement is
 * allowed to move off the cold path.
 *
 * `connect` and `readToken` are injected so every branch tests without a pipe.
 *
 * @module @paw/cli/pawdClient
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

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Injectable seams for testing.
 *
 * @interface RpcCallDeps
 * @property {(path: string) => Socket} [connect] - Open the socket; defaults to `node:net`.
 * @property {(path: string) => string} [readToken] - Read the handshake token; defaults to reading the file.
 * @property {number} [timeoutMs] - Give-up deadline; defaults to 2s.
 */
export interface RpcCallDeps {
  connect?: (path: string) => Socket;
  readToken?: (path: string) => string;
  timeoutMs?: number;
}

/**
 * Call one method on the daemon and resolve its result, or null on any failure.
 *
 * @param {string} socketPath - The daemon endpoint.
 * @param {string} tokenPath - The handshake token file.
 * @param {string} method - The method to call after the handshake.
 * @param {unknown} params - The method parameters.
 * @param {RpcCallDeps} [deps] - Injectable seams.
 * @returns {Promise<unknown | null>} The result, or null when anything went wrong.
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
