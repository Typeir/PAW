/**
 * PAW Config Binding Edits
 *
 * @fileoverview Pure transforms over a repo's config document that add a model,
 * bind a role to one, or clear a binding. Each returns a new document or a reason
 * it was refused; no I/O, so the authority that owns the file applies the result.
 * Validation matches {@link buildRegistry}: a role must be one PAW declares, and a
 * binding's model must already be declared.
 *
 * @module @paw/core/application/configBinding
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigDocument } from '../domain/config.js';
import type { CostClass, ModelCapabilities } from '../domain/role.js';
import { BUILTIN_ROLES } from './builtinRoles.js';

/**
 * The outcome of an edit: the next document, or the reason it was refused.
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
 * Whether a value is a plain object.
 *
 * @param {unknown} value - The value.
 * @returns {boolean} True for a non-null, non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a value as model capabilities, or say why it is not.
 *
 * @param {unknown} value - The candidate capabilities.
 * @returns {{ ok: true; capabilities: ModelCapabilities } | { ok: false; reason: string }} The parse.
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
 * Declare a model, or replace an existing declaration of the same id.
 *
 * @param {ConfigDocument} config - The current document.
 * @param {string} id - The model id.
 * @param {ModelCapabilities} capabilities - Its capabilities.
 * @returns {ConfigEdit} The next document, or a refusal.
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
 * Bind a role to a declared model.
 *
 * @param {ConfigDocument} config - The current document.
 * @param {string} roleId - The role to bind.
 * @param {string} modelId - The model to bind it to.
 * @returns {ConfigEdit} The next document, or a refusal.
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
 * Clear a role's binding, leaving it unbound.
 *
 * @param {ConfigDocument} config - The current document.
 * @param {string} roleId - The role to unbind.
 * @returns {ConfigEdit} The next document, or a refusal.
 */
export function clearBinding(config: ConfigDocument, roleId: string): ConfigEdit {
  if (!ROLE_IDS.has(roleId)) {
    return { ok: false, reason: `unknown role "${roleId}"` };
  }
  const roles = { ...config.roles };
  delete roles[roleId];
  return { ok: true, config: { ...config, roles } };
}
