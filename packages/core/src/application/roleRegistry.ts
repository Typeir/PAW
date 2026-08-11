/**
 * PAW Role Registry
 *
 * @fileoverview Resolve role to runnable model handle. Validate every binding
 * (`doctor`). Binding carry {@link ModelPort}, interface adapter implement.
 * Module and all above know only abstract model. Swap provider, swap adapter binding.
 *
 * @module @paw/core/application/roleRegistry
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  satisfies,
  type ModelCapabilities,
  type RoleDeclaration,
  type Satisfaction,
} from '../domain/role.js';
import type { ModelPort } from '../ports/index.js';

/**
 * Model bound to role: model id, capabilities, port that run it. Port be provider
 * boundary (copilot-sdk, openai-compatible, ollama). Nothing outside adapter know which.
 *
 * @interface ModelBinding
 * @property {string} modelId - Provider-local model id, passed to port.
 * @property {ModelCapabilities} capabilities - Declared capabilities, validated against role.
 * @property {ModelPort} port - Adapter that run completions for this binding.
 */
export interface ModelBinding {
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;
  readonly port: ModelPort;
}

/**
 * Runnable model, resolved. Caller run `port.complete({ model: modelId, … })`.
 *
 * @interface ModelHandle
 * @property {ModelPort} port - Port to call.
 * @property {string} modelId - Model id to pass.
 * @property {number} maxOutputTokens - Bound model output ceiling.
 */
export interface ModelHandle {
  readonly port: ModelPort;
  readonly modelId: string;
  readonly maxOutputTokens: number;
}

/**
 * Role declarations and bindings, as daemon hold them.
 *
 * @interface RoleRegistry
 * @property {ReadonlyMap<string, RoleDeclaration>} declarations - Declared roles, by id.
 * @property {ReadonlyMap<string, ModelBinding>} bindings - Role id → bound model.
 */
export interface RoleRegistry {
  readonly declarations: ReadonlyMap<string, RoleDeclaration>;
  readonly bindings: ReadonlyMap<string, ModelBinding>;
}

/**
 * One row of role doctor.
 *
 * @interface RoleDoctorRow
 * @property {string} role - Role id.
 * @property {boolean} optional - Role optional or not.
 * @property {string | null} boundTo - Bound model id, null when unbound.
 * @property {Satisfaction | null} satisfaction - Satisfaction verdict, null when unbound.
 * @property {boolean} blocking - True when row block release: required role unbound or unsatisfied.
 */
export interface RoleDoctorRow {
  readonly role: string;
  readonly optional: boolean;
  readonly boundTo: string | null;
  readonly satisfaction: Satisfaction | null;
  readonly blocking: boolean;
}

/**
 * Validate every declared role against binding.
 *
 * @param {RoleRegistry} registry - Declarations and bindings.
 * @returns {RoleDoctorRow[]} One row per declared role.
 */
export function doctorRoles(registry: RoleRegistry): RoleDoctorRow[] {
  const rows: RoleDoctorRow[] = [];
  for (const decl of registry.declarations.values()) {
    const binding = registry.bindings.get(decl.id);
    if (!binding) {
      rows.push({
        role: decl.id,
        optional: decl.optional,
        boundTo: null,
        satisfaction: null,
        blocking: !decl.optional,
      });
      continue;
    }
    const satisfaction = satisfies(decl.requires, binding.capabilities);
    rows.push({
      role: decl.id,
      optional: decl.optional,
      boundTo: binding.modelId,
      satisfaction,
      blocking: !decl.optional && !satisfaction.ok,
    });
  }
  return rows;
}

/**
 * Resolve role to runnable model handle.
 *
 * @param {RoleRegistry} registry - Declarations and bindings.
 * @param {string} roleId - Role to resolve.
 * @returns {ModelHandle | null} Handle, or null when OPTIONAL role unbound or unsatisfied. Per CONSTRAINTS.md Constraint 3, caller MUST surface null (logged skip or `role.unavailable` event).
 * @throws {Error} When role unknown, or REQUIRED role unbound or unsatisfied.
 */
export function resolveModel(
  registry: RoleRegistry,
  roleId: string,
): ModelHandle | null {
  const decl = registry.declarations.get(roleId);
  if (!decl) {
    throw new Error(`unknown role "${roleId}"`);
  }
  const binding = registry.bindings.get(roleId);
  if (!binding) {
    if (decl.optional) {
      return null;
    }
    throw new Error(`role "${roleId}" is unbound and not optional`);
  }
  const satisfaction = satisfies(decl.requires, binding.capabilities);
  if (!satisfaction.ok) {
    if (decl.optional) {
      return null;
    }
    throw new Error(
      `role "${roleId}" binding ${binding.modelId} does not satisfy: ${satisfaction.reasons.join('; ')}`,
    );
  }
  return {
    port: binding.port,
    modelId: binding.modelId,
    maxOutputTokens: binding.capabilities.maxOutputTokens,
  };
}
