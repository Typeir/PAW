/**
 * PAW Surface Adapter Types
 *
 * @fileoverview Core type definitions for the PAW horizontal adapter layer.
 * Defines the canonical event model, hook/agent/skill definitions, and the
 * {@link PawSurfaceAdapter} interface that each surface adapter implements.
 *
 * @module .github/PAW/adapters/types
 * @author Typeir
 * @version 1.0.0
 * @since 4.0.0
 * @see {@link file://./00-surface-routing.md} Part 0: Surface Routing
 */

/**
 * PAW canonical hook events. These are surface-agnostic names that each
 * adapter translates to the target surface's naming convention.
 *
 * @enum {string}
 */
export enum PawEvent {
  /** Fires when a Copilot session begins. */
  SessionStart = 'session:start',
  /** Fires when the user submits a prompt. */
  PromptSubmitted = 'prompt:submitted',
  /** Fires before a tool is executed. Can deny execution. */
  ToolPre = 'tool:pre',
  /** Fires after a tool has executed. Can report violations. */
  ToolPost = 'tool:post',
  /** Fires when a session is ending. Can block termination. */
  SessionEnd = 'session:end',
  /** Fires when a sub-agent is invoked. Extension-only. */
  SubagentStart = 'subagent:start',
  /** Fires when a sub-agent completes. Extension-only. */
  SubagentStop = 'subagent:stop',
  /** Fires before context compaction. Extension-only. */
  ContextCompact = 'context:compact',
  /** Fires on unrecoverable errors. SDK-only. */
  Error = 'error',
}

/**
 * Target surface identifiers.
 *
 * @typedef {'cli' | 'extension' | 'sdk' | 'all'} PawSurface
 */
export type PawSurface = 'cli' | 'extension' | 'sdk' | 'all';

/**
 * Configuration for surface selection, read from `.paw/config.json`.
 *
 * @interface PawConfig
 * @property {PawSurface} surface - Which surface(s) to generate configs for
 */
export interface PawConfig {
  surface: PawSurface;
}

/**
 * Definition of a single PAW hook mapping. Links a handler file to a
 * canonical event with a timeout budget.
 *
 * @interface PawHookDef
 * @property {string} file - Filename (no path) in .paw/hooks/
 * @property {PawEvent} event - PAW canonical event this hook serves
 * @property {number} timeoutSec - Max seconds before the surface kills the hook
 */
export interface PawHookDef {
  file: string;
  event: PawEvent;
  timeoutSec: number;
}

/**
 * Definition of a PAW agent for cross-surface compilation.
 *
 * @interface PawAgentDef
 * @property {string} name - Agent identifier
 * @property {string} description - Human-readable purpose
 * @property {string[]} tools - Allowed tool names (runtime-enforced on SDK)
 * @property {string} prompt - System prompt or path to prompt file
 * @property {boolean} infer - Whether the surface auto-delegates to this agent
 * @property {string[]} [handoffs] - Agent names this agent can hand off to
 */
export interface PawAgentDef {
  name: string;
  description: string;
  tools: string[];
  prompt: string;
  infer: boolean;
  handoffs?: string[];
}

/**
 * Definition of a PAW skill for cross-surface compilation.
 *
 * @interface PawSkillDef
 * @property {string} name - Skill identifier
 * @property {string} directory - Relative path to the skill directory
 * @property {string[]} [requires] - Dependency skill names (PAW resolves these)
 */
export interface PawSkillDef {
  name: string;
  directory: string;
  requires?: string[];
}

/**
 * Output produced by an adapter's hook config generation.
 *
 * @interface SurfaceHookOutput
 * @property {string} filePath - Relative path where the output should be written
 * @property {string} content - Serialized config content (JSON or TypeScript)
 */
export interface SurfaceHookOutput {
  filePath: string;
  content: string;
}

/**
 * Contract that every surface adapter must implement.
 * `pawSync.ts` calls these methods to compile PAW canonical definitions
 * into surface-specific configuration files.
 *
 * @interface PawSurfaceAdapter
 * @property {PawSurface} name - Surface identifier
 */
export interface PawSurfaceAdapter {
  /** Surface identifier. */
  readonly name: 'cli' | 'extension' | 'sdk';

  /**
   * Generate the hook configuration for this surface.
   *
   * @param hooks - PAW canonical hook definitions
   * @returns Output file path and serialized content
   */
  generateHookConfig(hooks: PawHookDef[]): SurfaceHookOutput;

  /**
   * Translate a PAW canonical event to the surface-specific event name.
   * Returns null if the surface does not support the event.
   *
   * @param event - PAW canonical event
   * @returns Surface-specific event name, or null if unsupported
   */
  getEventName(event: PawEvent): string | null;

  /**
   * Format a hook script invocation for this surface's command schema.
   *
   * @param script - Shell command to execute (e.g. "npx tsx .paw/hooks/pre-tool-use.ts")
   * @param timeout - Timeout in seconds
   * @returns Surface-specific command object
   */
  getCommandFormat(script: string, timeout: number): Record<string, unknown>;
}
