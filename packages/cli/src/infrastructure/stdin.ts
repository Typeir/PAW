/**
 * PAW CLI Stdin
 *
 * @fileoverview Read all stdin as text. Shared process-shell primitive for
 * `check` and `hook` commands. Raw process I/O. Skip unit coverage like
 * `main.ts`; cover by E2E suites that spawn CLI.
 *
 * @module @paw/cli/infrastructure/stdin
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Read all stdin as text.
 *
 * @returns {Promise<string>} Full stdin contents, UTF-8 decoded.
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
