/**
 * PAW Config Binding Edits
 *
 * @fileoverview Pure transform over repo config document. Add model, bind role to one, or clear binding. Each return new document or reason refuse; no I/O; file owner apply result. Validation match {@link buildRegistry}: role must be one PAW declare, and binding model must already declare.
 *
 * @module @paw/core/application/configBinding
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigDocument } from '../domain/config.js';
import {
  VENDOR_CONNECTORS,
  enabledConnectorIds,
  knownConnector,
} from '../domain/connectors.js';
import type { CostClass, ModelCapabilities } from '../domain/role.js';
import { BUILTIN_ROLES } from './builtinRoles.js';

/**
 * Outcome of edit: next document, or reason why not allowed.
 */
export type ConfigEdit =
  | { readonly ok: true; readonly config: ConfigDocument }
  | { readonly ok: false; readonly reason: string };

const ROLE_IDS: ReadonlySet<string> = new Set(BUILTIN_ROLES.map((role) => role.id));
const COST_CLASSES: ReadonlySet<string> = new Set<CostClass>([
  'trivial',
  'cheap',
  'standard',
  'premium',
]);

/**
 * Whether value be plain object.
 *
 * @param {unknown} value - Value.
 * @returns {boolean} True for non-null, non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate value as model capabilities, or say why it not.
 *
 * @param {unknown} value - Candidate capabilities.
 * @returns {{ ok: true; capabilities: ModelCapabilities } | { ok: false; reason: string }} Parse.
 */
export function parseCapabilities(
  value: unknown,
): { ok: true; capabilities: ModelCapabilities } | { ok: false; reason: string } {
  if (!isObject(value)) {
    return { ok: false, reason: 'capabilities must be an object' };
  }
  const numbers = ['contextTokens', 'maxOutputTokens'] as const;
  for (const key of numbers) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      return { ok: false, reason: `${key} must be a positive number` };
    }
  }
  const booleans = ['tools', 'structuredOutput', 'reasoning', 'vision'] as const;
  for (const key of booleans) {
    if (typeof value[key] !== 'boolean') {
      return { ok: false, reason: `${key} must be a boolean` };
    }
  }
  if (typeof value.costClass !== 'string' || !COST_CLASSES.has(value.costClass)) {
    return { ok: false, reason: `costClass must be one of ${[...COST_CLASSES].join(', ')}` };
  }
  return {
    ok: true,
    capabilities: {
      contextTokens: value.contextTokens as number,
      maxOutputTokens: value.maxOutputTokens as number,
      tools: value.tools as boolean,
      structuredOutput: value.structuredOutput as boolean,
      reasoning: value.reasoning as boolean,
      vision: value.vision as boolean,
      costClass: value.costClass as CostClass,
    },
  };
}

/**
 * Declare model, or replace existing declaration of same id.
 *
 * @param {ConfigDocument} config - Current document.
 * @param {string} id - Model id.
 * @param {ModelCapabilities} capabilities - Capabilities.
 * @returns {ConfigEdit} Next document, or refusal.
 */
export function declareModel(
  config: ConfigDocument,
  id: string,
  capabilities: ModelCapabilities,
): ConfigEdit {
  if (id.trim() === '') {
    return { ok: false, reason: 'a model id is required' };
  }
  return { ok: true, config: { ...config, models: { ...config.models, [id]: capabilities } } };
}

/**
 * Bind role to declared model.
 *
 * @param {ConfigDocument} config - Current document.
 * @param {string} roleId - Role to bind.
 * @param {string} modelId - Model to bind it to.
 * @returns {ConfigEdit} Next document, or refusal.
 */
export function setBinding(config: ConfigDocument, roleId: string, modelId: string): ConfigEdit {
  if (!ROLE_IDS.has(roleId)) {
    return { ok: false, reason: `unknown role "${roleId}"` };
  }
  if (config.models?.[modelId] === undefined) {
    return { ok: false, reason: `model "${modelId}" is not declared` };
  }
  return { ok: true, config: { ...config, roles: { ...config.roles, [roleId]: modelId } } };
}

/**
 * Enable a catalogued connector. Unknown ids are refused. Idempotent.
 *
 * @param {ConfigDocument} config - The config document.
 * @param {string} id - Connector id.
 * @returns {ConfigEdit} New config, or refusal.
 */
export function enableConnector(config: ConfigDocument, id: string): ConfigEdit {
  if (!knownConnector(id)) {
    return {
      ok: false,
      reason: `unknown connector "${id}"; known: ${VENDOR_CONNECTORS.map((c) => c.id).join(', ')}`,
    };
  }
  const current = enabledConnectorIds(config);
  return {
    ok: true,
    config: { ...config, connectors: current.includes(id) ? current : [...current, id] },
  };
}

/**
 * Disable a connector. Disabling one that is not enabled is a no-op edit.
 *
 * @param {ConfigDocument} config - The config document.
 * @param {string} id - Connector id.
 * @returns {ConfigEdit} New config.
 */
export function disableConnector(config: ConfigDocument, id: string): ConfigEdit {
  return {
    ok: true,
    config: { ...config, connectors: enabledConnectorIds(config).filter((cid) => cid !== id) },
  };
}

/**
 * Clear role binding, leave it unbound.
 *
 * @param {ConfigDocument} config - Current document.
 * @param {string} roleId - Role to unbind.
 * @returns {ConfigEdit} Next document, or refusal.
 */
export function clearBinding(config: ConfigDocument, roleId: string): ConfigEdit {
  if (!ROLE_IDS.has(roleId)) {
    return { ok: false, reason: `unknown role "${roleId}"` };
  }
  const roles = { ...config.roles };
  delete roles[roleId];
  return { ok: true, config: { ...config, roles } };
}
