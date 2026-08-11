/**
 * PAW Console Config Client
 *
 * @fileoverview Binding editor transport. Read declared models, bind role, unbind role. Read goes to `GET /api/config`; write goes to daemon control verbs, which respond only when the daemon starts with `--control`. Write returns whether it succeeded and, when it did not, the reason the daemon returned, so the view can display why. Transport uses the same authenticated {@link FetchLike} the snapshot source uses, so credentials are never handled here.
 *
 * @module @paw/gui/infrastructure/configClient
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { FetchLike, ResponseLike } from './snapshotSource.js';

/**
 * Daemon config read endpoint.
 */
export const CONFIG_URL = '/api/config';

/**
 * Daemon role-binding write endpoint.
 */
export const CONFIG_ROLES_URL = '/api/config/roles';

/**
 * Outcome of write.
 *
 * @interface ConfigWrite
 * @property {boolean} ok - Whether edit took.
 * @property {string} [reason] - Why refused, when be.
 */
export interface ConfigWrite {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Binding editor verbs.
 *
 * @interface ConfigClient
 * @property {() => Promise<readonly string[]>} models - Declared model ids.
 * @property {(role: string, model: string) => Promise<ConfigWrite>} bind - Bind role to model.
 * @property {(role: string) => Promise<ConfigWrite>} unbind - Clear role binding.
 */
export interface ConfigClient {
  models(): Promise<readonly string[]>;
  bind(role: string, model: string): Promise<ConfigWrite>;
  unbind(role: string): Promise<ConfigWrite>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * Turn write response into outcome. 2xx take. Refusal carry reason as JSON (`configControl` — undeclared model, bad parameter) or plain text (transport refusal — control disabled, bad token), and text body not JSON, so parse guarded, fall back to status.
 *
 * @param {ResponseLike} response - Write response.
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
 * Build config client over authenticated transport.
 *
 * @param {FetchLike} fetchFn - Authenticated transport.
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
