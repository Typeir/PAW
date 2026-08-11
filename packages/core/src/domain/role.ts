/**
 * PAW Role Domain
 *
 * @fileoverview Role declare capability need. Binding map role to model with declared capability. Module decide binding meet need. Provider-agnostic: role never name model, domain never name provider. Bind no-tools model to editing role = validation error, surface before spend token.
 *
 * @module @paw/core/domain/role
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Budget tier. `trivial` work run thousand time a day; `premium` for hardest, low-volume work.
 */
export type CostClass = 'trivial' | 'cheap' | 'standard' | 'premium';

/**
 * Latency tolerance. `interactive` not block a hook; `batch` take minutes.
 */
export type LatencyClass = 'interactive' | 'background' | 'batch';

/**
 * What role bound model must do.
 *
 * @interface RoleRequirements
 * @property {number} minContextTokens - Smallest usable prompt window.
 * @property {number} maxOutputTokens - Output role expect to consume.
 * @property {boolean} tools - Role issue tool calls?
 * @property {boolean} structuredOutput - Relies on schema-constrained arguments?
 * @property {boolean} reasoning - Benefit from extended-thinking mode?
 * @property {boolean} vision - Sends images?
 * @property {CostClass} costClass - Most expensive tier role pay.
 * @property {LatencyClass} latencyClass - Role latency tolerance.
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
 * Named unit of model work PAW do internal.
 *
 * @interface RoleDeclaration
 * @property {string} id - Stable dotted id, config binding reference.
 * @property {string} owner - Subsystem that consume it, for diagnostics.
 * @property {string} purpose - One line, show by `paw roles ls`.
 * @property {RoleRequirements} requires - Capability contract binding must satisfy.
 * @property {boolean} optional - True = subsystem degrade if role unbound or unsatisfied.
 */
export interface RoleDeclaration {
  readonly id: string;
  readonly owner: string;
  readonly purpose: string;
  readonly requires: RoleRequirements;
  readonly optional: boolean;
}

/**
 * Model declared capabilities, as data.
 *
 * @interface ModelCapabilities
 * @property {number} contextTokens - Max context window.
 * @property {number} maxOutputTokens - Max output tokens.
 * @property {boolean} tools - Support tool calls?
 * @property {boolean} structuredOutput - Support schema-constrained output?
 * @property {boolean} reasoning - Support extended-thinking mode?
 * @property {boolean} vision - Accept images?
 * @property {CostClass} costClass - Model cost tier.
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
 * Verdict of satisfaction check.
 *
 * @interface Satisfaction
 * @property {boolean} ok - Model satisfy requirement?
 * @property {readonly string[]} reasons - One entry per unmet requirement; empty when ok.
 */
export interface Satisfaction {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * Rank of cost tier, cheapest first.
 */
const COST_RANK: Readonly<Record<CostClass, number>> = {
  trivial: 0,
  cheap: 1,
  standard: 2,
  premium: 3,
};

/**
 * Boolean capability to check, paired with phrase used when unmet.
 */
const BOOL_CAPS: ReadonlyArray<readonly [keyof RoleRequirements & keyof ModelCapabilities, string]> = [
  ['tools', 'tool calls'],
  ['structuredOutput', 'structured output'],
  ['reasoning', 'reasoning'],
  ['vision', 'vision'],
];

/**
 * Decide model capability satisfy role requirement.
 *
 * @param {RoleRequirements} req - What role need.
 * @param {ModelCapabilities} cap - What model provide.
 * @returns {Satisfaction} Satisfy or not, reason per shortfall.
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
