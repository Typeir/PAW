/**
 * PAW Agent Lifecycle Adapter
 *
 * @fileoverview Defines how PAW's A→B→C agent lifecycle (Analyzer →
 * Implementer → HealthReviewer → Auditor) maps to each Copilot surface.
 * Each surface has a different mechanism for phase transitions:
 *
 * - Extension: `handoffs` in `.agent.md` YAML frontmatter (visual UI)
 * - CLI: Sequential programmatic invocations with tool scoping flags
 * - SDK: `customAgents[]` with runtime tool scoping and sub-agent delegation
 *
 * @module .github/PAW/adapters/lifecycle
 * @author Typeir
 * @version 1.0.0
 * @since 4.0.0
 */

/**
 * PAW lifecycle phases in execution order.
 *
 * @enum {string}
 */
export enum PawLifecyclePhase {
  /** Read-only analysis; produces task summary. */
  Analysis = 'analysis',
  /** Code changes following the task summary. */
  Implementation = 'implementation',
  /** Mandatory quality gate execution. */
  HealthReview = 'health-review',
  /** Final reconciliation of checklist and milestones. */
  CompletionAudit = 'completion-audit',
}

/**
 * Tool categories used for phase-based tool scoping.
 *
 * @enum {string}
 */
export enum ToolCategory {
  /** Read-only tools (grep, glob, view, read_file, semantic_search). */
  ReadOnly = 'read-only',
  /** Write tools (edit, replace_string_in_file, create_file). */
  Write = 'write',
  /** Terminal execution (run_in_terminal). */
  Terminal = 'terminal',
  /** All tools (no restrictions). */
  All = 'all',
}

/**
 * Definition of a lifecycle phase with its tool scope and transition rules.
 *
 * @interface PawPhaseConfig
 * @property {PawLifecyclePhase} phase - Phase identifier
 * @property {string} agentName - Name of the agent for this phase
 * @property {string} description - Human-readable phase purpose
 * @property {ToolCategory[]} allowedTools - Tool categories permitted in this phase
 * @property {PawLifecyclePhase | null} nextPhase - Phase to transition to on completion
 */
export interface PawPhaseConfig {
  phase: PawLifecyclePhase;
  agentName: string;
  description: string;
  allowedTools: ToolCategory[];
  nextPhase: PawLifecyclePhase | null;
}

/**
 * The PAW lifecycle definition: ordered phases with tool scoping.
 *
 * @type {PawPhaseConfig[]}
 */
export const PAW_LIFECYCLE: PawPhaseConfig[] = [
  {
    phase: PawLifecyclePhase.Analysis,
    agentName: 'Analyzer',
    description:
      'Read-only analysis agent that creates task summaries. Never modifies source code.',
    allowedTools: [ToolCategory.ReadOnly],
    nextPhase: PawLifecyclePhase.Implementation,
  },
  {
    phase: PawLifecyclePhase.Implementation,
    agentName: 'Implementer',
    description:
      'Implements code changes following the task summary. Runs health checks after changes.',
    allowedTools: [
      ToolCategory.ReadOnly,
      ToolCategory.Write,
      ToolCategory.Terminal,
    ],
    nextPhase: PawLifecyclePhase.HealthReview,
  },
  {
    phase: PawLifecyclePhase.HealthReview,
    agentName: 'HealthReviewer',
    description:
      'Runs the mandatory quality gate. Classifies findings as critical or warning.',
    allowedTools: [ToolCategory.ReadOnly, ToolCategory.Terminal],
    nextPhase: PawLifecyclePhase.CompletionAudit,
  },
  {
    phase: PawLifecyclePhase.CompletionAudit,
    agentName: 'CompletionAuditor',
    description:
      'Reconciles checklist items against health results. Generates completion report.',
    allowedTools: [ToolCategory.ReadOnly, ToolCategory.Write],
    nextPhase: null,
  },
];

/**
 * Map tool categories to concrete tool names for the SDK surface.
 * These are the tool names recognized by the Copilot SDK `customAgents[].tools` array.
 *
 * @type {Record<ToolCategory, string[]>}
 */
export const SDK_TOOL_MAP: Record<ToolCategory, string[]> = {
  [ToolCategory.ReadOnly]: [
    'grep',
    'glob',
    'view',
    'read_file',
    'semantic_search',
    'list_dir',
    'file_search',
    'grep_search',
  ],
  [ToolCategory.Write]: [
    'edit',
    'editFiles',
    'insert_edit',
    'replace_string_in_file',
    'multi_replace_string_in_file',
    'create_file',
  ],
  [ToolCategory.Terminal]: ['run_in_terminal', 'get_terminal_output'],
  [ToolCategory.All]: [],
};

/**
 * Map tool categories to CLI tool approval flags.
 * Returns the `--allow-tool` and `--deny-tool` flags for `copilot -p` invocations.
 *
 * @param allowedCategories - Tool categories permitted for this phase
 * @returns CLI flags as a string array
 */
export function getCLIToolFlags(allowedCategories: ToolCategory[]): string[] {
  if (allowedCategories.includes(ToolCategory.All)) {
    return ['--allow-all-tools'];
  }

  const flags: string[] = [];
  for (const category of allowedCategories) {
    for (const tool of SDK_TOOL_MAP[category]) {
      flags.push(`--allow-tool='${tool}'`);
    }
  }

  return flags;
}

/**
 * Resolve the concrete SDK tool names for a set of tool categories.
 *
 * @param allowedCategories - Tool categories permitted for this phase
 * @returns Array of concrete tool names
 */
export function resolveSDKTools(allowedCategories: ToolCategory[]): string[] {
  if (allowedCategories.includes(ToolCategory.All)) {
    return [];
  }

  const tools = new Set<string>();
  for (const category of allowedCategories) {
    for (const tool of SDK_TOOL_MAP[category]) {
      tools.add(tool);
    }
  }

  return [...tools];
}
