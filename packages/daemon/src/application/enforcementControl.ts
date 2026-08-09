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
 * @property {(method: string, params: unknown) => Promise<unknown | null>} [rpc] - One round trip to pawd; defaults to a real socket call.
 */
export interface EnforcementControlSeams {
  rpc?: (method: string, params: unknown) => Promise<unknown | null>;
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
 * @param {string} root - The repository the console serves.
 * @param {EnforcementControlSeams} [seams] - Injectable seams.
 * @returns {ControlPort} The registered writes.
 */
export function enforcementControl(root: string, seams: EnforcementControlSeams = {}): ControlPort {
  const endpoint = socketPath(root, {
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tmpdir: tmpdir(),
  });
  const token = tokenPath(resolve(root, '.paw'));
  const rpc = seams.rpc ?? ((method, params) => rpcCall(endpoint, token, method, params));
  return {
    handlers: {
      'DELETE /api/violations': async ({ query }) => {
        const file = query?.get('file');
        const result = await rpc('violations.prune', file ? { file } : {});
        return result === null ? UNREACHABLE : { status: 200, body: result };
      },
      'POST /api/daemon/stop': async () => {
        const result = await rpc('daemon.stop', {});
        return result === null ? UNREACHABLE : { status: 202, body: result };
      },
    },
  };
}
