/**
 * PAW Enforcement Control Bridge
 *
 * @fileoverview The console's write verbs, as thin bridges to the enforcement
 * daemon's socket. The console (`paw ui`) holds no violation store of its own —
 * that lives in the resident pawd the hooks autostart — so an operator pruning
 * the backlog or stopping enforcement from the console is one JSON-RPC round trip
 * to that daemon over the same socket the CLI and TUI use. There is exactly one
 * place a write is validated and dispatched, and this reuses it rather than
 * opening a second.
 *
 * The scope is resolved per request, not captured at construction: a console
 * grabs one consumer at a time and can switch to another, so each verb targets
 * the socket of whichever consumer the console currently holds.
 *
 * A daemon that does not answer is not an error to surface loudly: pawd may simply
 * not be running for this repository. The round trip fails open to null and the
 * verb answers 503 with a plain reason, so the console can say "no enforcement
 * daemon here" rather than hang or 500.
 *
 * This is exposed only when the operator starts the console with `--control`; the
 * default console composes no control port and stays observational.
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
 * @property {(method: string, params: unknown, root: string) => Promise<unknown | null>} [rpc] - One round trip to the pawd for `root`; defaults to a real socket call.
 */
export interface EnforcementControlSeams {
  rpc?: (method: string, params: unknown, root: string) => Promise<unknown | null>;
}

/**
 * One round trip to the enforcement pawd for a repository, over its socket.
 *
 * @param {string} method - The JSON-RPC method.
 * @param {unknown} params - Its params.
 * @param {string} root - The repository whose pawd to reach.
 * @returns {Promise<unknown | null>} The result, or null when no pawd answered.
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
 * The answer when pawd did not respond: no enforcement daemon is holding a store
 * for this repository, which is a state to report, not a failure to hide.
 */
const UNREACHABLE: ControlResult = {
  status: 503,
  body: { error: 'no enforcement daemon is running for this repository' },
};

/**
 * The control port a `--control` console exposes: the enforcement writes, each a
 * single round trip to the resident pawd for this repository.
 *
 * @param {string | (() => string)} root - The repository the console serves, or a getter for the scope it currently holds.
 * @param {EnforcementControlSeams} [seams] - Injectable seams.
 * @returns {ControlPort} The registered writes.
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
