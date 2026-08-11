/**
 * PAW Env-Local Parse
 *
 * @fileoverview Pure half of loading a `.env.local` for live herd: take file
 * text and make `DEEPSEEK_*` name/value pairs SDK egress read as provider key.
 * Keep separate from filesystem walk and `process.env` write (those live in
 * excluded live-herd shell) so parsing — only part with branches — stay
 * unit-covered. Lift only `DEEPSEEK_` names, strip surrounding quotes; ignore
 * everything else.
 *
 * @module @paw/daemon/model/envLocal
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

const DEEPSEEK_LINE = /^\s*(DEEPSEEK_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/;

/**
 * Parse `.env.local` body into `DEEPSEEK_*` pairs.
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
