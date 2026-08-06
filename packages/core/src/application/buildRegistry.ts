/**
 * PAW Registry Builder
 *
 * @fileoverview Builds a {@link RoleRegistry} from a repo's config: the role
 * declarations come from code ({@link BUILTIN_ROLES}), the model capabilities and
 * role→model bindings come from config, and the {@link ModelPort} for each binding
 * is injected — a placeholder for the doctor, which never calls it, or a real
 * adapter for a run. This is the composition step every face (CLI, TUI, GUI)
 * shares, so it lives in core rather than being copied per surface. Fails loud per
 * CONSTRAINTS.md Constraint 3: a role bound to a model the config never declared
 * throws rather than silently binding nothing.
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
 * The registry-relevant slice of a repo's config.
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
 * Build a role registry from config and a port factory.
 *
 * @param {RegistryConfig} config - The models and bindings.
 * @param {(modelId: string) => ModelPort} portFor - Supplies the port for a model id.
 * @returns {RoleRegistry} The declarations plus resolved bindings.
 * @throws {Error} When a role is bound to a model the config did not declare.
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
