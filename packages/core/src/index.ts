/**
 * PAW Core — Public API
 *
 * @fileoverview The pure library that `cli`, `tui`, `gui`, and `daemon` consume.
 * Re-exports the domain, the application use-cases, and the ports; imports
 * nothing outside `node:*` and its own modules, and is the only surface
 * consumers are permitted to depend on.
 *
 * @module @paw/core
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { decidePreToolUse } from './domain/enforcement.js';
export type { Decision, PreToolInput } from './domain/enforcement.js';

export type {
  PawEvent,
  PawEventType,
  PawResponse,
  PromptSubmittedEvent,
  SessionEndEvent,
  SessionStartEvent,
  ToolPostEvent,
  ToolPreEvent,
} from './domain/event.js';

export { validateConfig } from './domain/config.js';
export type { ConfigProblem, PawConfig } from './domain/config.js';

export { handleEvent } from './application/handleEvent.js';
export type { HandleDeps } from './application/handleEvent.js';

export {
  allIndirect,
  directlyViolatedFiles,
  formatIndirectNudge,
  formatOutstanding,
} from './domain/violation.js';
export type { Violation } from './domain/violation.js';

export {
  isSuppressed,
  parseIgnoreDirectives,
} from './domain/gateIgnore.js';
export type { IgnoreDirectives } from './domain/gateIgnore.js';

export {
  contextOf,
  doctorPlan,
  memberCount,
  planKey,
  renderBrief,
  targetsOf,
} from './domain/swarm.js';
export type { DoctorFinding, SwarmPlan } from './domain/swarm.js';

export { satisfies } from './domain/role.js';
export type {
  CostClass,
  LatencyClass,
  ModelCapabilities,
  RoleDeclaration,
  RoleRequirements,
  Satisfaction,
} from './domain/role.js';

export {
  doctorRoles,
  resolveModel,
} from './application/roleRegistry.js';
export type {
  ModelBinding,
  ModelHandle,
  RoleDoctorRow,
  RoleRegistry,
} from './application/roleRegistry.js';

export { BUILTIN_ROLES } from './application/builtinRoles.js';

export { buildRegistry } from './application/buildRegistry.js';
export type { RegistryConfig } from './application/buildRegistry.js';

export { CONTEXT_HEADING, composeBrief } from './application/composeBrief.js';

export { checkTool } from './application/checkTool.js';
export type { CheckToolRequest } from './application/checkTool.js';

export { runDoctor } from './application/doctor.js';
export type { DoctorReport } from './application/doctor.js';

export { dispatchSwarm } from './application/dispatchSwarm.js';
export type {
  DispatchDeps,
  DispatchResult,
  MemberOutcome,
} from './application/dispatchSwarm.js';

export type {
  ClockPort,
  FileReaderPort,
  HostConnector,
  ModelPort,
  ModelRequest,
  ModelResponse,
  PresenterPort,
  ProcessPort,
  ProcessResult,
  ProcessRunOptions,
  SecretPort,
  StorePort,
} from './ports/index.js';

export type {
  BudgetSummary,
  DaemonStatus,
  HostInfo,
  HostProcess,
  MemberView,
  MemberViewState,
  PawSnapshot,
  RailChrome,
  RunProgress,
  TreeNode,
} from './contracts.js';
