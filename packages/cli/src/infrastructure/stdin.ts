/**
 * PAW CLI Stdin
 *
 * @fileoverview Read all stdin as text, or one hidden line from the terminal.
 * Shared process-shell primitives for
 * `check`, `hook`, and `providers add`. Raw process I/O. Skip unit coverage like
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

/**
 * Read one line from the terminal without echoing it. Enter ends the line,
 * backspace deletes, Ctrl+C rejects. Requires stdin to be a TTY.
 * @param {string} label - Prompt written to stderr.
 * @returns {Promise<string>} The typed line, without the line break.
 */
export async function readHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(label);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('cancelled'));
          return;
        }
        value = ch === '\u007f' || ch === '\b' ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on('data', onData);
  });
}
