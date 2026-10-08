/**
 * PAW Registry Builder
 *
 * @fileoverview Build {@link RoleRegistry} from repo config: role
 * declarations from code ({@link BUILTIN_ROLES}), model capabilities and
 * role→model bindings from config, inject {@link ModelPort} for each binding.
 * The port factory runs only in the run path; the doctor service never calls
 * it. Composition step shared by CLI, TUI, and GUI; defined in core. Per
 * CONSTRAINTS.md Constraint 3, throws when a role is bound to a model the
 * config does not declare.
 *
 * @module @paw/core/application/buildRegistry
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ModelCapabilities } from '../domain/role.js';
import type { ModelPort } from '../ports/index.js';
import { BUILTIN_ROLES } from './builtinRoles.js';
import {
  judgeRole,
  type ModelBinding,
  type RoleDoctorRow,
  type RoleRegistry,
} from './roleRegistry.js';

/**
 * Registry-relevant slice of repo config.
 *
 * @interface RegistryConfig
 * @property {Record<string, ModelCapabilities>} [models] - Declared models by id, with their capabilities.
 * @property {Record<string, string>} [roles] - Role id → model id bindings.
 */
export interface RegistryConfig {
  readonly models?: Readonly<Record<string, ModelCapabilities>>;
  readonly roles?: Readonly<Record<string, string>>;
}

/**
 * Build role registry from config and port factory.
 *
 * @param {RegistryConfig} config - The models and bindings.
 * @param {(modelId: string) => ModelPort} portFor - Supply port for model id.
 * @returns {RoleRegistry} The declarations plus resolved bindings.
 * @throws {Error} When role bound to model config did not declare.
 */
export function buildRegistry(
  config: RegistryConfig,
  portFor: (modelId: string) => ModelPort,
): RoleRegistry {
  const declarations = new Map(BUILTIN_ROLES.map((d) => [d.id, d]));
  const bindings = new Map<string, ModelBinding>();
  for (const [roleId, modelId] of Object.entries(config.roles ?? {})) {
    const capabilities = config.models?.[modelId];
    if (!capabilities) {
      throw new Error(
        `role "${roleId}" is bound to model "${modelId}", which the config does not declare`,
      );
    }
    bindings.set(roleId, { modelId, capabilities, port: portFor(modelId) });
  }
  return { declarations, bindings };
}

/**
 * Validate every declared role against the config alone, with no port opened.
 * Same rows as {@link doctorRoles}, reachable from a display path: a role bound
 * to a model the config does not declare is reported as an unsatisfied row
 * rather than thrown, so `paw config show` can print it.
 *
 * @param {RegistryConfig} config - The models and bindings.
 * @returns {RoleDoctorRow[]} One row per declared role.
 */
export function doctorConfigRoles(config: RegistryConfig): RoleDoctorRow[] {
  return BUILTIN_ROLES.map((decl) => {
    const modelId = config.roles?.[decl.id];
    if (modelId === undefined) {
      return judgeRole(decl, null, null);
    }
    return judgeRole(decl, modelId, config.models?.[modelId] ?? null);
  });
}
