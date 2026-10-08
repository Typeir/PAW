/**
 * PAW Plan Doctor
 *
 * @fileoverview Plan validation plus the role-binding check dispatch makes.
 * {@link doctorPlan} judges plan shape only; a plan whose role no bound model
 * satisfies passes it and then throws at dispatch, after the runtime is
 * already open. This module adds that check so `swarm doctor` refuses first.
 *
 * @module @paw/core/application/planDoctor
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { satisfies, type ModelCapabilities } from '../domain/role.js';
import { doctorPlan, type DoctorFinding, type SwarmPlan } from '../domain/swarm.js';
import { BUILTIN_ROLES } from './builtinRoles.js';

/**
 * Model a plan would run against.
 *
 * @interface PlanBinding
 * @property {string} modelId - Provider-local model id.
 * @property {ModelCapabilities} capabilities - What that model declares it can do.
 */
export interface PlanBinding {
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;
}

/**
 * Check the plan's role is declared and the model it would bind to satisfies
 * it. A null binding means no model was resolved; the check reports that it
 * could not run rather than passing silently.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {PlanBinding | null} binding - Model the run would use, or null when none was resolved.
 * @returns {DoctorFinding} Role-binding finding.
 */
export function checkRoleBinding<A>(
  plan: SwarmPlan<A>,
  binding: PlanBinding | null,
): DoctorFinding {
  const decl = BUILTIN_ROLES.find((role) => role.id === plan.role);
  if (decl === undefined) {
    return {
      check: 'role-binding',
      ok: false,
      detail: `unknown role "${plan.role}"; known: ${BUILTIN_ROLES.map((r) => r.id).join(', ')}`,
    };
  }
  if (binding === null) {
    return {
      check: 'role-binding',
      ok: true,
      detail: `${plan.role} — not checked; pass --live to check the model the run would bind`,
    };
  }
  const verdict = satisfies(decl.requires, binding.capabilities);
  return verdict.ok
    ? { check: 'role-binding', ok: true, detail: `${plan.role} → ${binding.modelId}` }
    : {
        check: 'role-binding',
        ok: false,
        detail: `${plan.role} → ${binding.modelId}: ${verdict.reasons.join('; ')}`,
      };
}

/**
 * Plan findings with the role-binding finding appended.
 *
 * @param {SwarmPlan<A>} plan - The plan.
 * @param {PlanBinding | null} binding - Model the run would use, or null when none was resolved.
 * @returns {DoctorFinding[]} Findings, in check order.
 */
export function doctorPlanWithBinding<A>(
  plan: SwarmPlan<A>,
  binding: PlanBinding | null,
): DoctorFinding[] {
  return [...doctorPlan(plan), checkRoleBinding(plan, binding)];
}
