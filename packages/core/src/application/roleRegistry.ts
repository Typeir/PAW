/**
 * PAW Role Registry
 *
 * @fileoverview Resolves a role to a runnable model handle, and validates every
 * binding (`doctor`). This is the seam that keeps the provider swappable: a
 * binding carries a {@link ModelPort} — an interface an adapter implements — so
 * this module, and everything above it, knows only "a model I can call". The
 * Copilot SDK is one such adapter and is never named here; changing herder
 * provider is a change to which adapter a binding holds, one file, not a rewrite
 * that ripples through the codebase. Decoupled today, while the surface is small,
 * rather than at fifty times the size.
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
 * A model bound to a role: which model, what it can do, and the port that runs
 * it. The port is the provider boundary — copilot-sdk, openai-compatible,
 * ollama — and nothing outside the adapter knows which.
 *
 * @interface ModelBinding
 * @property {string} modelId - Provider-local model id passed to the port.
 * @property {ModelCapabilities} capabilities - Declared capabilities, validated against the role.
 * @property {ModelPort} port - The adapter that runs completions for this binding.
 */
export interface ModelBinding {
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;
  readonly port: ModelPort;
}

/**
 * A resolved, runnable model. The caller runs `port.complete({ model: modelId, … })`;
 * whichever provider is behind the port is immaterial.
 *
 * @interface ModelHandle
 * @property {ModelPort} port - The port to call.
 * @property {string} modelId - The model id to pass.
 */
export interface ModelHandle {
  readonly port: ModelPort;
  readonly modelId: string;
}

/**
 * The role declarations and their bindings, as the daemon holds them.
 *
 * @interface RoleRegistry
 * @property {ReadonlyMap<string, RoleDeclaration>} declarations - Declared roles by id.
 * @property {ReadonlyMap<string, ModelBinding>} bindings - Role id → bound model.
 */
export interface RoleRegistry {
  readonly declarations: ReadonlyMap<string, RoleDeclaration>;
  readonly bindings: ReadonlyMap<string, ModelBinding>;
}

/**
 * One row of the role doctor.
 *
 * @interface RoleDoctorRow
 * @property {string} role - The role id.
 * @property {boolean} optional - Whether the role is optional.
 * @property {string | null} boundTo - The bound model id, or null when unbound.
 * @property {Satisfaction | null} satisfaction - The satisfaction verdict, or null when unbound.
 * @property {boolean} blocking - True when this row should block a release: a required role that is unbound or unsatisfied.
 */
export interface RoleDoctorRow {
  readonly role: string;
  readonly optional: boolean;
  readonly boundTo: string | null;
  readonly satisfaction: Satisfaction | null;
  readonly blocking: boolean;
}

/**
 * Validate every declared role against its binding.
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
 * Resolve a role to a runnable model handle.
 *
 * @param {RoleRegistry} registry - Declarations and bindings.
 * @param {string} roleId - The role to resolve.
 * @returns {ModelHandle | null} A handle, or null when an OPTIONAL role is unbound or unsatisfied. Per CONSTRAINTS.md Constraint 3 the null is a loud, handled degradation, not a hiding place: the caller MUST surface it (a logged skip / a `role.unavailable` event), never quietly move on.
 * @throws {Error} When the role is unknown, or a REQUIRED role is unbound or unsatisfied — failing loudly rather than shipping a swarm that runs and produces nothing.
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
  return { port: binding.port, modelId: binding.modelId };
}
