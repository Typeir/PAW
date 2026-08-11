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
import type { ModelBinding, RoleRegistry } from './roleRegistry.js';

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
