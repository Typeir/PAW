/**
 * PAW Config Control Port
 *
 * @fileoverview Console config-editing verbs, apply in daemon. Daemon hold
 * filesystem authority. Browser send; daemon write. Every verb read document,
 * run core edit, write back on good. Refused edit be 422 with reason. No round
 * trip needed: config live beside daemon.
 *
 * @module @paw/daemon/configControl
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  clearBinding,
  declareModel,
  disableConnector,
  enableConnector,
  enabledConnectorIds,
  parseCapabilities,
  setBinding,
  type ConfigDocumentPort,
  type ConfigEdit,
} from '@paw/core';
import type { ControlPort, ControlResult } from '../domain/control.js';

/**
 * Build 422, carry refusal reason.
 *
 * @param {string} reason - Refusal reason.
 * @returns {ControlResult} The result.
 */
function refuse(reason: string): ControlResult {
  return { status: 422, body: { ok: false, reason } };
}

/**
 * Return value when string, else null.
 *
 * @param {unknown} value - The value.
 * @returns {string | null} The string, else null.
 */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Build control port. Port edit repo config document: bind role, declare model,
 * clear binding.
 *
 * @param {ConfigDocumentPort} configDoc - Document to read and write.
 * @returns {ControlPort} Registered writes.
 */
export function configControl(configDoc: ConfigDocumentPort): ControlPort {
  const commit = async (edit: ConfigEdit): Promise<ControlResult> => {
    if (!edit.ok) {
      return refuse(edit.reason);
    }
    await configDoc.write(edit.config);
    return {
      status: 200,
      body: {
        ok: true,
        roles: edit.config.roles ?? {},
        models: edit.config.models ?? {},
        connectors: enabledConnectorIds(edit.config),
      },
    };
  };
  return {
    handlers: {
      'PUT /api/config/roles': async ({ body }) => {
        const roleId = asString(body.role);
        const modelId = asString(body.model);
        if (roleId === null || modelId === null) {
          return refuse('role and model must be strings');
        }
        return commit(setBinding(await configDoc.read(), roleId, modelId));
      },
      'DELETE /api/config/roles': async ({ query, body }) => {
        const roleId = asString(body.role) ?? query?.get('role') ?? null;
        if (roleId === null) {
          return refuse('role is required');
        }
        return commit(clearBinding(await configDoc.read(), roleId));
      },
      'PUT /api/connectors': async ({ body }) => {
        const id = asString(body.id);
        if (id === null) {
          return refuse('id must be a string');
        }
        return commit(enableConnector(await configDoc.read(), id));
      },
      'DELETE /api/connectors': async ({ query, body }) => {
        const id = asString(body.id) ?? query?.get('id') ?? null;
        if (id === null) {
          return refuse('id is required');
        }
        return commit(disableConnector(await configDoc.read(), id));
      },
      'PUT /api/config/models': async ({ body }) => {
        const id = asString(body.id);
        if (id === null) {
          return refuse('id must be a string');
        }
        const parsed = parseCapabilities(body.capabilities);
        if (!parsed.ok) {
          return refuse(parsed.reason);
        }
        return commit(declareModel(await configDoc.read(), id, parsed.capabilities));
      },
    },
  };
}
