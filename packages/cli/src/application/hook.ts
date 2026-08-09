/**
 * PAW Hook Bridge (thin client)
 *
 * @fileoverview `paw hook --<host> <event>` — a thin client of the resident
 * daemon (doc 10 §7). It reads the host's hook payload from stdin, asks pawd to
 * decide via `hook.dispatch`, and writes pawd's answer back — or, on any daemon
 * trouble, the host's do-nothing output. It owns no store, no gates, no
 * connector: those live in the daemon, where one owner and one warm cache serve
 * every hook. Fail-open is the whole contract, so a daemon problem never bricks a
 * hook.
 *
 * @module @paw/cli/application/hook
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { rpcCall } from '@paw/daemon';

/**
 * The stdin/stdout seam, injected so the bridge tests without a process.
 *
 * @interface HookIo
 * @property {() => Promise<string>} readStdin - Read the whole host payload.
 * @property {(text: string) => void} writeStdout - Emit the host output.
 */
export interface HookIo {
  readStdin(): Promise<string>;
  writeStdout(text: string): void;
}

/**
 * What the bridge needs to make one call.
 *
 * @interface HookOptions
 * @property {string} host - The host key the command named.
 * @property {string} event - The canonical event the command named.
 * @property {string} socketPath - The daemon endpoint.
 * @property {string} tokenPath - The handshake token file.
 * @property {HookIo} io - The stdin/stdout seam.
 * @property {typeof rpcCall} [call] - The RPC call; injected in tests.
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
 * Parse the host payload, treating a non-object or malformed body as empty — the
 * daemon decides on whatever it can, and an unreadable payload just resolves to
 * nothing to enforce.
 *
 * @param {string} raw - The stdin text.
 * @returns {Record<string, unknown>} The payload object, or {}.
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
 * Bridge one host hook invocation to the daemon.
 *
 * @param {HookOptions} opts - Host, event, endpoint, io, and optional call seam.
 * @returns {Promise<number>} The exit code — always 0; the decision rides in the JSON.
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
