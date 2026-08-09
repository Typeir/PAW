/**
 * PAW CLI Stdin
 *
 * @fileoverview Reads all of stdin as text — the one process-shell primitive the
 * `check` and `hook` commands share. Kept apart so both import it without a cycle
 * through the composition root, and excluded from unit coverage for the same
 * reason `main.ts` is: raw process I/O, exercised by the E2E suites that spawn
 * the CLI.
 *
 * @module @paw/cli/stdin
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Read all of stdin as text.
 *
 * @returns {Promise<string>} The full stdin contents, UTF-8 decoded.
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
