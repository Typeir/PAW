/**
 * PAW Doctor Service
 *
 * @fileoverview The unified pre-flight check the CLI, TUI, and GUI all render —
 * one service, three faces. It composes the config validation and the role
 * doctor into a single report and a single `ok` verdict: PAW is ready to run
 * only when the config resolves and no required role is unbound or unsatisfied.
 * Pure over its inputs, so it is exhaustively testable and every surface shows
 * the same truth.
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
 * The combined health of a PAW installation.
 *
 * @interface DoctorReport
 * @property {ConfigProblem[]} config - Config validation problems; empty when the config is sound.
 * @property {RoleDoctorRow[]} roles - One row per declared role.
 * @property {boolean} ok - True only when the config is sound and no required role is blocking.
 */
export interface DoctorReport {
  readonly config: ConfigProblem[];
  readonly roles: RoleDoctorRow[];
  readonly ok: boolean;
}

/**
 * Run the unified doctor.
 *
 * @param {unknown} config - The parsed config object to validate.
 * @param {RoleRegistry} registry - The role declarations and bindings.
 * @param {readonly string[]} knownConnectors - Connector names PAW can resolve.
 * @returns {DoctorReport} The combined report and readiness verdict.
 */
export function runDoctor(
  config: unknown,
  registry: RoleRegistry,
  knownConnectors: readonly string[],
): DoctorReport {
  const configProblems = validateConfig(config, knownConnectors);
  const roles = doctorRoles(registry);
  const ok = configProblems.length === 0 && roles.every((r) => !r.blocking);
  return { config: configProblems, roles, ok };
}
