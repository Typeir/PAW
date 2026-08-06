/**
 * PAW Role Domain
 *
 * @fileoverview Roles declare a capability requirement; a binding maps a role to
 * a model with declared capabilities; this module decides whether the binding
 * satisfies the requirement. Provider-agnostic by construction — a role never
 * names a model and this domain never names a provider. That is the seam decision
 * doc 12 argues for, and it is why binding a no-tools model to an editing role is
 * a validation error a person sees before any tokens are spent, not a silent
 * swarm that files nothing.
 *
 * @module @paw/core/domain/role
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Budget tier. `trivial` work runs thousands of times a day; `premium` is
 * reserved for the hardest, lowest-volume work.
 */
export type CostClass = 'trivial' | 'cheap' | 'standard' | 'premium';

/**
 * Latency tolerance. `interactive` must not block a hook; `batch` may take
 * minutes.
 */
export type LatencyClass = 'interactive' | 'background' | 'batch';

/**
 * What a role's bound model must be able to do.
 *
 * @interface RoleRequirements
 * @property {number} minContextTokens - Smallest usable prompt window.
 * @property {number} maxOutputTokens - Output the role expects to consume.
 * @property {boolean} tools - Whether the role issues tool calls.
 * @property {boolean} structuredOutput - Whether it relies on schema-constrained arguments.
 * @property {boolean} reasoning - Whether it benefits from an extended-thinking mode.
 * @property {boolean} vision - Whether it sends images.
 * @property {CostClass} costClass - The most expensive tier the role will pay.
 * @property {LatencyClass} latencyClass - The role's latency tolerance.
 */
export interface RoleRequirements {
  readonly minContextTokens: number;
  readonly maxOutputTokens: number;
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly reasoning: boolean;
  readonly vision: boolean;
  readonly costClass: CostClass;
  readonly latencyClass: LatencyClass;
}

/**
 * A named unit of model work PAW performs internally.
 *
 * @interface RoleDeclaration
 * @property {string} id - Stable dotted identifier referenced by config bindings.
 * @property {string} owner - Subsystem that consumes it, for diagnostics.
 * @property {string} purpose - One line shown by `paw roles ls`.
 * @property {RoleRequirements} requires - The capability contract a binding must satisfy.
 * @property {boolean} optional - When true, the subsystem degrades instead of failing if the role is unbound or unsatisfied.
 */
export interface RoleDeclaration {
  readonly id: string;
  readonly owner: string;
  readonly purpose: string;
  readonly requires: RoleRequirements;
  readonly optional: boolean;
}

/**
 * A model's declared capabilities — data, because no provider reports these
 * reliably across the field PAW must span.
 *
 * @interface ModelCapabilities
 * @property {number} contextTokens - Maximum context window.
 * @property {number} maxOutputTokens - Maximum output tokens.
 * @property {boolean} tools - Supports tool calls.
 * @property {boolean} structuredOutput - Supports schema-constrained output.
 * @property {boolean} reasoning - Supports an extended-thinking mode.
 * @property {boolean} vision - Accepts images.
 * @property {CostClass} costClass - The model's cost tier.
 */
export interface ModelCapabilities {
  readonly contextTokens: number;
  readonly maxOutputTokens: number;
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly reasoning: boolean;
  readonly vision: boolean;
  readonly costClass: CostClass;
}

/**
 * The verdict of a satisfaction check.
 *
 * @interface Satisfaction
 * @property {boolean} ok - Whether the model satisfies the requirement.
 * @property {readonly string[]} reasons - One entry per unmet requirement; empty when ok.
 */
export interface Satisfaction {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * Rank of a cost tier, cheapest first.
 */
const COST_RANK: Readonly<Record<CostClass, number>> = {
  trivial: 0,
  cheap: 1,
  standard: 2,
  premium: 3,
};

/**
 * Boolean capabilities to check, paired with the phrase used when unmet.
 */
const BOOL_CAPS: ReadonlyArray<readonly [keyof RoleRequirements & keyof ModelCapabilities, string]> = [
  ['tools', 'tool calls'],
  ['structuredOutput', 'structured output'],
  ['reasoning', 'reasoning'],
  ['vision', 'vision'],
];

/**
 * Decide whether a model's capabilities satisfy a role's requirements.
 *
 * @param {RoleRequirements} req - What the role needs.
 * @param {ModelCapabilities} cap - What the model provides.
 * @returns {Satisfaction} Whether it satisfies, with a reason per shortfall.
 */
export function satisfies(
  req: RoleRequirements,
  cap: ModelCapabilities,
): Satisfaction {
  const reasons: string[] = [];

  if (cap.contextTokens < req.minContextTokens) {
    reasons.push(
      `context ${cap.contextTokens} < required ${req.minContextTokens}`,
    );
  }
  if (cap.maxOutputTokens < req.maxOutputTokens) {
    reasons.push(
      `max output ${cap.maxOutputTokens} < required ${req.maxOutputTokens}`,
    );
  }
  for (const [key, label] of BOOL_CAPS) {
    if (req[key] && !cap[key]) {
      reasons.push(`requires ${label}`);
    }
  }
  if (COST_RANK[cap.costClass] > COST_RANK[req.costClass]) {
    reasons.push(
      `cost tier ${cap.costClass} exceeds allowed ${req.costClass}`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}
