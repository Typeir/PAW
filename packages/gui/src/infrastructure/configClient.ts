/**
 * PAW Console Config Client
 *
 * @fileoverview Binding editor transport. Read declared models, bind role, unbind role. Read goes to `GET /api/config`; write goes to daemon control verbs, which refuse when the daemon starts with `--read-only`. Write returns whether it succeeded and, when it did not, the reason the daemon returned, so the view can display why. Transport uses the same authenticated {@link FetchLike} the snapshot source uses, so credentials are never handled here.
 *
 * @module @paw/gui/infrastructure/configClient
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { BackendSyncReport, RepoTaskView, TaskListRow } from '@paw/core';
import type { FetchLike, ResponseLike } from './snapshotSource.js';

/**
 * Daemon config read endpoint.
 */
export const CONFIG_URL = '/api/config';

/**
 * Daemon provider-roster read endpoint.
 */
export const PROVIDERS_URL = '/api/providers';

/**
 * Daemon connector roster read and enable/disable endpoint.
 */
export const CONNECTORS_URL = '/api/connectors';

/**
 * Daemon module roster read and enable/disable endpoint.
 */
export const MODULES_URL = '/api/modules';

/**
 * Daemon task-graph read endpoint.
 */
export const TASKS_URL = '/api/tasks';

/**
 * Daemon backend sync write endpoint.
 */
export const TASKS_SYNC_URL = '/api/tasks/sync';

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
 * Declared models and role bindings, as `/api/config` serves them.
 *
 * @interface ConfigBindings
 * @property {readonly string[]} models - Declared model ids.
 * @property {Readonly<Record<string, string>>} roles - Role id → model id bindings.
 */
export interface ConfigBindings {
  readonly models: readonly string[];
  readonly roles: Readonly<Record<string, string>>;
}

/**
 * One provider on the key-free roster `/api/providers` serves.
 *
 * @interface ProviderRow
 * @property {string} name - Provider name.
 * @property {string} [type] - Wire format, when its file parses.
 * @property {string} [baseUrl] - Endpoint, when its file parses.
 * @property {string} [model] - Default model id, when declared.
 * @property {number} [keyChars] - Credential length. Never the credential.
 * @property {string} [error] - Parse failure reason for a broken file.
 */
export interface ProviderRow {
  readonly name: string;
  readonly type?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly keyChars?: number;
  readonly error?: string;
}

/**
 * One connector on the catalogue `/api/connectors` serves.
 *
 * @interface ConnectorRow
 * @property {string} id - Stable connector id.
 * @property {string} kind - `host` bridge or `linter`.
 * @property {string} title - Display name.
 * @property {string} description - What enabling it does.
 * @property {boolean} enabled - Whether the repo config enables it.
 * @property {readonly string[]} requires - Module ids that must be enabled first.
 */
export interface ConnectorRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly requires: readonly string[];
}

/**
 * One module on the catalogue `/api/modules` serves.
 *
 * @interface ModuleRow
 * @property {string} id - Stable module id.
 * @property {string} title - Display name.
 * @property {string} description - What the module owns.
 * @property {string} specifier - Package specifier the daemon resolved.
 * @property {boolean} enabled - Whether the repo config enables it.
 * @property {boolean} resolved - Whether the daemon located the package.
 * @property {string} detail - Where it resolved to, or why it did not.
 * @property {readonly string[]} requiredBy - Connectors that need it.
 */
export interface ModuleRow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly specifier: string;
  readonly enabled: boolean;
  readonly resolved: boolean;
  readonly detail: string;
  readonly requiredBy: readonly string[];
}

/**
 * One task the graph endpoint serves: a list row with its tracker link.
 */
export type TaskGraphRow = TaskListRow;

/**
 * What the graph endpoint serves: rows, refusals, and each enabled backend's freshness.
 */
export type TaskGraphView = RepoTaskView;

/**
 * Outcome of a sync request: the per-connector reports, or why the daemon refused the request.
 */
export type TaskSyncResult =
  | { readonly ok: true; readonly reports: readonly BackendSyncReport[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Binding editor, Keys view, and Connectors view verbs.
 *
 * @interface ConfigClient
 * @property {() => Promise<readonly string[]>} models - Declared model ids.
 * @property {() => Promise<ConfigBindings>} bindings - Declared models and every role binding.
 * @property {() => Promise<readonly ProviderRow[]>} providers - Key-free provider roster.
 * @property {() => Promise<readonly ConnectorRow[]>} connectors - Connector catalogue with enabled state.
 * @property {() => Promise<readonly ModuleRow[]>} modules - Module catalogue with enabled and resolved state.
 * @property {() => Promise<TaskGraphView>} tasks - Task graph rows, refusals, and backend freshness.
 * @property {(full: boolean) => Promise<TaskSyncResult>} syncTasks - Sync every enabled backend; `full` forces a full sweep.
 * @property {(role: string, model: string) => Promise<ConfigWrite>} bind - Bind role to model.
 * @property {(role: string) => Promise<ConfigWrite>} unbind - Clear role binding.
 * @property {(id: string, on: boolean) => Promise<ConfigWrite>} setConnector - Enable or disable a connector.
 * @property {(id: string, on: boolean) => Promise<ConfigWrite>} setModule - Enable or disable a module.
 */
export interface ConfigClient {
  models(): Promise<readonly string[]>;
  bindings(): Promise<ConfigBindings>;
  providers(): Promise<readonly ProviderRow[]>;
  connectors(): Promise<readonly ConnectorRow[]>;
  modules(): Promise<readonly ModuleRow[]>;
  tasks(): Promise<TaskGraphView>;
  syncTasks(full: boolean): Promise<TaskSyncResult>;
  bind(role: string, model: string): Promise<ConfigWrite>;
  unbind(role: string): Promise<ConfigWrite>;
  setConnector(id: string, on: boolean): Promise<ConfigWrite>;
  setModule(id: string, on: boolean): Promise<ConfigWrite>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * Turn refused write response into its reason. Refusal carry reason as JSON (`configControl` — undeclared model, bad parameter) or plain text (transport refusal — control disabled, bad token), and text body not JSON, so parse guarded, fall back to status.
 *
 * @param {ResponseLike} response - Non-2xx write response.
 * @returns {Promise<{ ok: false; reason: string }>} The refusal.
 */
async function refusalOf(response: ResponseLike): Promise<{ readonly ok: false; readonly reason: string }> {
  try {
    const reason = (await response.json() as { reason?: unknown }).reason;
    return { ok: false, reason: typeof reason === 'string' ? reason : `HTTP ${response.status}` };
  } catch {
    return { ok: false, reason: `HTTP ${response.status}` };
  }
}

/**
 * Turn write response into outcome. 2xx take; anything else is a refusal.
 *
 * @param {ResponseLike} response - Write response.
 * @returns {Promise<ConfigWrite>} The outcome.
 */
async function writeResult(response: ResponseLike): Promise<ConfigWrite> {
  return response.ok ? { ok: true } : refusalOf(response);
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
    async bindings(): Promise<ConfigBindings> {
      const response = await fetchFn(CONFIG_URL);
      if (!response.ok) {
        throw new Error(`PAW console: ${CONFIG_URL} responded ${response.status}`);
      }
      const body = (await response.json()) as Partial<ConfigBindings>;
      return { models: body.models ?? [], roles: body.roles ?? {} };
    },
    async providers(): Promise<readonly ProviderRow[]> {
      const response = await fetchFn(PROVIDERS_URL);
      if (!response.ok) {
        throw new Error(`PAW console: ${PROVIDERS_URL} responded ${response.status}`);
      }
      return (await response.json()) as readonly ProviderRow[];
    },
    async connectors(): Promise<readonly ConnectorRow[]> {
      const response = await fetchFn(CONNECTORS_URL);
      if (!response.ok) {
        throw new Error(`PAW console: ${CONNECTORS_URL} responded ${response.status}`);
      }
      return (await response.json()) as readonly ConnectorRow[];
    },
    async setConnector(id: string, on: boolean): Promise<ConfigWrite> {
      return writeResult(
        await fetchFn(on ? CONNECTORS_URL : `${CONNECTORS_URL}?id=${encodeURIComponent(id)}`, {
          method: on ? 'PUT' : 'DELETE',
          headers: JSON_HEADERS,
          ...(on ? { body: JSON.stringify({ id }) } : {}),
        }),
      );
    },
    async tasks(): Promise<TaskGraphView> {
      const response = await fetchFn(TASKS_URL);
      if (!response.ok) {
        throw new Error(`PAW console: ${TASKS_URL} responded ${response.status}`);
      }
      return (await response.json()) as TaskGraphView;
    },
    async syncTasks(full: boolean): Promise<TaskSyncResult> {
      const response = await fetchFn(TASKS_SYNC_URL, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ full }),
      });
      if (!response.ok) {
        return refusalOf(response);
      }
      return { ok: true, reports: ((await response.json()) as { reports: readonly BackendSyncReport[] }).reports };
    },
    async modules(): Promise<readonly ModuleRow[]> {
      const response = await fetchFn(MODULES_URL);
      if (!response.ok) {
        throw new Error(`PAW console: ${MODULES_URL} responded ${response.status}`);
      }
      return (await response.json()) as readonly ModuleRow[];
    },
    async setModule(id: string, on: boolean): Promise<ConfigWrite> {
      return writeResult(
        await fetchFn(on ? MODULES_URL : `${MODULES_URL}?id=${encodeURIComponent(id)}`, {
          method: on ? 'PUT' : 'DELETE',
          headers: JSON_HEADERS,
          ...(on ? { body: JSON.stringify({ id }) } : {}),
        }),
      );
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
