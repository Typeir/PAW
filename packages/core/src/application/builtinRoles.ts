/**
 * PAW Built-in Role Declarations
 *
 * @fileoverview The capability contracts PAW's own subsystems declare, as data.
 * These live in core, not in a consumer, because a subsystem knows what it needs
 * regardless of which face (CLI, TUI, GUI) is driving; a repo binds them to models
 * in its config and {@link buildRegistry} validates the binding. Roles live in
 * code because a subsystem knows what it needs; models live in config because a
 * user knows what they will pay for.
 *
 * @module @paw/core/application/builtinRoles
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { RoleDeclaration } from '../domain/role.js';

/**
 * The roles PAW declares. Optional roles degrade loudly when unbound; required
 * roles block until bound and satisfied.
 *
 * @constant
 * @type {RoleDeclaration[]}
 */
export const BUILTIN_ROLES: RoleDeclaration[] = [
  {
    id: 'edit.apply',
    owner: 'swarm',
    purpose: 'Apply one scoped edit to one file with judgment.',
    optional: false,
    requires: {
      minContextTokens: 32_000,
      maxOutputTokens: 8_192,
      tools: true,
      structuredOutput: false,
      reasoning: false,
      vision: false,
      costClass: 'cheap',
      latencyClass: 'batch',
    },
  },
  {
    id: 'review.graze',
    owner: 'swarm',
    purpose: 'Read a shard and file structured findings.',
    optional: false,
    requires: {
      minContextTokens: 128_000,
      maxOutputTokens: 8_192,
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      costClass: 'cheap',
      latencyClass: 'batch',
    },
  },
  {
    id: 'review.judge',
    owner: 'swarm',
    purpose: 'Refute a surviving finding.',
    optional: false,
    requires: {
      minContextTokens: 128_000,
      maxOutputTokens: 16_384,
      tools: true,
      structuredOutput: true,
      reasoning: true,
      vision: false,
      costClass: 'standard',
      latencyClass: 'batch',
    },
  },
  {
    id: 'memory.draft',
    owner: 'memory',
    purpose: 'Draft a short file memory after an edit.',
    optional: true,
    requires: {
      minContextTokens: 32_000,
      maxOutputTokens: 4_096,
      tools: false,
      structuredOutput: false,
      reasoning: false,
      vision: false,
      costClass: 'trivial',
      latencyClass: 'background',
    },
  },
];
