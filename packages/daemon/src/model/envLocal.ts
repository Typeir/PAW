/**
 * PAW Env-Local Parse
 *
 * @fileoverview The pure half of loading a `.env.local` for a live herd: turn the
 * file's text into the `DEEPSEEK_*` name/value pairs the SDK egress reads as its
 * provider key. Kept separate from the filesystem walk and the `process.env`
 * write (which live in the excluded live-herd shell) so the parsing — the only
 * part with branches — is unit-covered. Only `DEEPSEEK_` names are lifted and
 * surrounding quotes are stripped; everything else is ignored.
 *
 * @module @paw/daemon/model/envLocal
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

const DEEPSEEK_LINE = /^\s*(DEEPSEEK_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/;

/**
 * Parse a `.env.local` body into its `DEEPSEEK_*` pairs.
 *
 * @param {string} text - The file contents.
 * @returns {Array<[string, string]>} Name/value pairs, quotes stripped, in order.
 */
export function parseDeepseekEnv(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    const match = DEEPSEEK_LINE.exec(line);
    if (match) {
      pairs.push([match[1], match[2].replace(/^["']|["']$/g, '')]);
    }
  }
  return pairs;
}
