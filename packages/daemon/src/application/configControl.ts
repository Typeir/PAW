/**
 * PAW Config Control Port
 *
 * @fileoverview The console's config-editing verbs, applied in the daemon that
 * holds filesystem authority — the browser sends the request, the daemon owns the
 * write. Each verb reads the document, runs a core edit, and on success writes it
 * back; a refused edit is a 422 with its reason. Unlike the enforcement verbs
 * these need no round trip: the config lives beside the daemon, not in a resident
 * pawd.
 *
 * @module @paw/daemon/configControl
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  clearBinding,
  declareModel,
  parseCapabilities,
  setBinding,
  type ConfigDocumentPort,
  type ConfigEdit,
} from '@paw/core';
import type { ControlPort, ControlResult } from '../domain/control.js';

/**
 * A 422 carrying why an edit was refused.
 *
 * @param {string} reason - The refusal reason.
 * @returns {ControlResult} The result.
 */
function refuse(reason: string): ControlResult {
  return { status: 422, body: { ok: false, reason } };
}

/**
 * A value as a string, or null.
 *
 * @param {unknown} value - The value.
 * @returns {string | null} The string, or null.
 */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The control port that edits a repo's config document: bind a role, declare a
 * model, clear a binding.
 *
 * @param {ConfigDocumentPort} configDoc - The document to read and write.
 * @returns {ControlPort} The registered writes.
 */
export function configControl(configDoc: ConfigDocumentPort): ControlPort {
  const commit = async (edit: ConfigEdit): Promise<ControlResult> => {
    if (!edit.ok) {
      return refuse(edit.reason);
    }
    await configDoc.write(edit.config);
    return {
      status: 200,
      body: { ok: true, roles: edit.config.roles ?? {}, models: edit.config.models ?? {} },
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
