/**
 * PAW Doctor Service
 *
 * @fileoverview Unified pre-flight check CLI, TUI, GUI render. Combine config
 * validation with role doctor into one report and one `ok` verdict: PAW ready
 * to run only when config resolve and no required role unbound or unsatisfied.
 * A binding to a role PAW does not declare is a config problem. Pure over its
 * inputs.
 *
 * @module @paw/core/application/doctor
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  validateConfig,
  type ConfigProblem,
} from '../domain/config.js';
import {
  doctorRoles,
  type RoleDoctorRow,
  type RoleRegistry,
} from './roleRegistry.js';

/**
 * Combined health of PAW installation.
 *
 * @interface DoctorReport
 * @property {ConfigProblem[]} config - Config validation problems; empty when config sound.
 * @property {RoleDoctorRow[]} roles - One row per declared role.
 * @property {boolean} ok - True only when config sound and no required role block.
 */
export interface DoctorReport {
  readonly config: ConfigProblem[];
  readonly roles: RoleDoctorRow[];
  readonly ok: boolean;
}

/**
 * One problem per binding whose role PAW does not declare.
 *
 * @param {RoleRegistry} registry - Declarations and bindings.
 * @returns {ConfigProblem[]} One `roles.<id>` problem per undeclared role, naming the unbind verb.
 */
function strayBindings(registry: RoleRegistry): ConfigProblem[] {
  return [...registry.bindings.keys()]
    .filter((id) => !registry.declarations.has(id))
    .map((id) => ({
      field: `roles.${id}`,
      message: `role "${id}" is not a PAW role; remove the binding with paw config unbind ${id}`,
    }));
}

/**
 * Run unified doctor.
 *
 * @param {unknown} config - Parsed config object to validate.
 * @param {RoleRegistry} registry - Role declarations and bindings.
 * @param {readonly string[]} knownConnectors - Connector names PAW can resolve.
 * @returns {DoctorReport} Combined report and readiness verdict.
 */
export function runDoctor(
  config: unknown,
  registry: RoleRegistry,
  knownConnectors: readonly string[],
): DoctorReport {
  const configProblems = [...validateConfig(config, knownConnectors), ...strayBindings(registry)];
  const roles = doctorRoles(registry);
  const ok = configProblems.length === 0 && roles.every((r) => !r.blocking);
  return { config: configProblems, roles, ok };
}
