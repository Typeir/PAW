/**
 * PAW Enforcement Control Bridge
 *
 * @fileoverview Console write verbs, thin bridge to enforcement daemon socket.
 * Console (`paw ui`) holds no violation store; the hooks autostart a resident
 * pawd that holds the store. Prune backlog or stop enforcement be one JSON-RPC
 * round trip to that pawd over same socket CLI and TUI use, reuse single
 * validated write path.
 *
 * Scope resolve per request: console hold one consumer at a time and can switch
 * to another, so each verb target socket of whichever consumer console currently
 * hold.
 *
 * When pawd no answer — maybe not running for this repository — round trip fail
 * open to null and verb answer 503 with plain reason.
 *
 * Exposed only when console start with `--control`; default console compose no
 * control port and stay observational.
 *
 * @module @paw/daemon/enforcementControl
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { ControlPort, ControlResult } from '../domain/control.js';
import { socketPath, tokenPath } from '../infrastructure/endpoint.js';
import { rpcCall } from '../infrastructure/rpcClient.js';

/**
 * Injectable seams for testing.
 *
 * @interface EnforcementControlSeams
 * @property {(method: string, params: unknown, root: string) => Promise<unknown | null>} [rpc] - One round trip to pawd for `root`; default to real socket call.
 */
export interface EnforcementControlSeams {
  rpc?: (method: string, params: unknown, root: string) => Promise<unknown | null>;
}

/**
 * One round trip to enforcement pawd for repository, over its socket.
 *
 * @param {string} method - The JSON-RPC method.
 * @param {unknown} params - Its params.
 * @param {string} root - Repository whose pawd to reach.
 * @returns {Promise<unknown | null>} Result, or null when no pawd answered.
 */
function socketRpc(method: string, params: unknown, root: string): Promise<unknown | null> {
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  return rpcCall(endpoint, tokenPath(resolve(root, '.paw')), method, params);
}

/**
 * Answer when pawd no respond: no enforcement daemon hold store for this
 * repository.
 */
const UNREACHABLE: ControlResult = {
  status: 503,
  body: { error: 'no enforcement daemon is running for this repository' },
};

/**
 * Control port a `--control` console expose: enforcement writes, each single
 * round trip to resident pawd for this repository.
 *
 * @param {string | (() => string)} root - Repository console serve, or getter for scope it currently hold.
 * @param {EnforcementControlSeams} [seams] - Injectable seams.
 * @returns {ControlPort} Registered writes.
 */
export function enforcementControl(
  root: string | (() => string),
  seams: EnforcementControlSeams = {},
): ControlPort {
  const currentRoot = typeof root === 'function' ? root : (): string => root;
  const rpc = seams.rpc ?? socketRpc;
  const call = (method: string, params: unknown): Promise<unknown | null> =>
    rpc(method, params, currentRoot());
  return {
    handlers: {
      'DELETE /api/violations': async ({ query }) => {
        const file = query?.get('file');
        const result = await call('violations.prune', file ? { file } : {});
        return result === null ? UNREACHABLE : { status: 200, body: result };
      },
      'POST /api/daemon/stop': async () => {
        const result = await call('daemon.stop', {});
        return result === null ? UNREACHABLE : { status: 202, body: result };
      },
    },
  };
}
