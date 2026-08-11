/**
 * PAW Hook Bridge (thin client)
 *
 * @fileoverview `paw hook --<host> <event>`: thin client of resident daemon
 * (doc 10 §7). Read host hook payload from stdin, ask pawd to decide via
 * `hook.dispatch`, write pawd answer back; on daemon trouble write host
 * do-nothing output. Own no store, gate, or connector; daemon hold those.
 * Fails open; daemon failure never stops hook.
 *
 * @module @paw/cli/application/hook
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { rpcCall } from '@paw/daemon';

/**
 * Stdin/stdout seam. Injected in tests.
 *
 * @interface HookIo
 * @property {() => Promise<string>} readStdin - Read whole host payload.
 * @property {(text: string) => void} writeStdout - Emit host output.
 */
export interface HookIo {
  readStdin(): Promise<string>;
  writeStdout(text: string): void;
}

/**
 * What bridge need to make one call.
 *
 * @interface HookOptions
 * @property {string} host - Host key command name.
 * @property {string} event - Canonical event command name.
 * @property {string} socketPath - Daemon endpoint.
 * @property {string} tokenPath - Handshake token file.
 * @property {HookIo} io - Stdin/stdout seam.
 * @property {typeof rpcCall} [call] - RPC call; injected in tests.
 */
export interface HookOptions {
  readonly host: string;
  readonly event: string;
  readonly socketPath: string;
  readonly tokenPath: string;
  readonly io: HookIo;
  readonly call?: typeof rpcCall;
}

/**
 * Parse host payload. Non-object or malformed body resolve to empty object.
 *
 * @param {string} raw - Stdin text.
 * @returns {Record<string, unknown>} Payload object, or {}.
 */
function safePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Bridge one host hook invocation to daemon.
 *
 * @param {HookOptions} opts - Host, event, endpoint, io, and optional call seam.
 * @returns {Promise<number>} Exit code — always 0; decision returned in writeStdout JSON.
 */
export async function runHook(opts: HookOptions): Promise<number> {
  const payload = safePayload(await opts.io.readStdin());
  const call = opts.call ?? rpcCall;
  const result = await call(opts.socketPath, opts.tokenPath, 'hook.dispatch', {
    host: opts.host,
    event: opts.event,
    payload,
  });
  opts.io.writeStdout(JSON.stringify(result ?? { continue: true }));
  return 0;
}
