/**
 * PAW Console Config Client
 *
 * @fileoverview The binding editor's transport: read the declared models, bind a
 * role to one, unbind a role. Reads go to `GET /api/config`; writes go to the
 * daemon's control verbs, which answer only when the daemon was started with
 * `--control`. A write returns whether it took and, when it did not, the reason
 * the daemon gave, so the view can say why rather than swallow it. The transport
 * is the same authenticated {@link FetchLike} the snapshot source uses, so the
 * credential is never handled here.
 *
 * @module @paw/gui/infrastructure/configClient
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FetchLike, ResponseLike } from './snapshotSource.js';

/**
 * The daemon's config read endpoint.
 */
export const CONFIG_URL = '/api/config';

/**
 * The daemon's role-binding write endpoint.
 */
export const CONFIG_ROLES_URL = '/api/config/roles';

/**
 * The outcome of a write.
 *
 * @interface ConfigWrite
 * @property {boolean} ok - Whether the edit took.
 * @property {string} [reason] - Why it was refused, when it was.
 */
export interface ConfigWrite {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * The binding editor's verbs.
 *
 * @interface ConfigClient
 * @property {() => Promise<readonly string[]>} models - The declared model ids.
 * @property {(role: string, model: string) => Promise<ConfigWrite>} bind - Bind a role to a model.
 * @property {(role: string) => Promise<ConfigWrite>} unbind - Clear a role's binding.
 */
export interface ConfigClient {
  models(): Promise<readonly string[]>;
  bind(role: string, model: string): Promise<ConfigWrite>;
  unbind(role: string): Promise<ConfigWrite>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * Turn a write response into an outcome. A 2xx took. A refusal carries its reason
 * as JSON (`configControl` — an undeclared model, a bad parameter) or as plain
 * text (a transport refusal — control disabled, a bad token), and a text body is
 * not JSON, so the parse is guarded and falls back to the status.
 *
 * @param {ResponseLike} response - The write response.
 * @returns {Promise<ConfigWrite>} The outcome.
 */
async function writeResult(response: ResponseLike): Promise<ConfigWrite> {
  if (response.ok) {
    return { ok: true };
  }
  try {
    const reason = (await response.json() as { reason?: unknown }).reason;
    return { ok: false, reason: typeof reason === 'string' ? reason : `HTTP ${response.status}` };
  } catch {
    return { ok: false, reason: `HTTP ${response.status}` };
  }
}

/**
 * Build a config client over an authenticated transport.
 *
 * @param {FetchLike} fetchFn - The authenticated transport.
 * @returns {ConfigClient} The client.
 */
export function createConfigClient(fetchFn: FetchLike): ConfigClient {
  return {
    async models(): Promise<readonly string[]> {
      const response = await fetchFn(CONFIG_URL);
      if (!response.ok) {
        throw new Error(`PAW console: ${CONFIG_URL} responded ${response.status}`);
      }
      return ((await response.json()) as { models?: readonly string[] }).models ?? [];
    },
    async bind(role: string, model: string): Promise<ConfigWrite> {
      return writeResult(
        await fetchFn(CONFIG_ROLES_URL, {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ role, model }),
        }),
      );
    },
    async unbind(role: string): Promise<ConfigWrite> {
      return writeResult(
        await fetchFn(`${CONFIG_ROLES_URL}?role=${encodeURIComponent(role)}`, {
          method: 'DELETE',
          headers: JSON_HEADERS,
        }),
      );
    },
  };
}
