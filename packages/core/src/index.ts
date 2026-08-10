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

export { chainCommand, mergeHookCommand } from './domain/hookMerge.js';
export type {
  HookMerge,
  HookMergeSpec,
  HookShell,
  MergeAction,
} from './domain/hookMerge.js';

export {
  RPC_ERROR,
  RPC_PROTOCOL_VERSION,
  encodeFrame,
  parseFrame,
  rpcFailure,
  rpcNotification,
  rpcRequest,
  rpcSuccess,
  splitFrames,
} from './domain/rpcWire.js';
export type {
  RpcErrorBody,
  RpcFailure,
  RpcFrame,
  RpcNotification,
  RpcRequest,
  RpcSuccess,
} from './domain/rpcWire.js';

export { PAW_EVENT_TYPES } from './domain/event.js';
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

export type {
  GateContext,
  GateFinding,
  GatePort,
  GateResult,
  GateStats,
  HealthReport,
  QualityGate,
} from './domain/gate.js';

export { validateConfig } from './domain/config.js';
export type { ConfigDocument, ConfigProblem, PawConfig } from './domain/config.js';

export { RECENT_ROUTES_CAP, promoteRoute } from './domain/recentRoutes.js';

export { toProjectRelative } from './domain/projectPath.js';

export { handleEvent } from './application/handleEvent.js';
export type { HandleDeps } from './application/handleEvent.js';

export { checkEdit } from './application/checkEdit.js';
export type { CheckEditDeps } from './application/checkEdit.js';

export { dispatchHook } from './application/dispatchHook.js';
export type { DispatchHookDeps, HookDispatch } from './application/dispatchHook.js';

export {
  allIndirect,
  directlyViolatedFiles,
  formatIndirectNudge,
  formatOutstanding,
  truncate,
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

export {
  AUTH_TIMEOUT_MS,
  BACKPRESSURE_CLOSE_BYTES,
  BACKPRESSURE_RESUME_BYTES,
  BACKPRESSURE_SKIP_BYTES,
  BACKPRESSURE_STALE_MS,
  CLIENT_SILENCE_MS,
  CLOSE_AUTH,
  CLOSE_BACKPRESSURE,
  CLOSE_CAPACITY,
  CLOSE_MALFORMED,
  CLOSE_ORIGIN,
  CLOSE_SHUTDOWN,
  LIVE_SUBPROTOCOL,
  LIVE_TOPICS,
  LIVE_VERSION,
  MAX_AUTH_FAILURES,
  MAX_FRAME_BYTES,
  MAX_MESSAGES_PER_WINDOW,
  MAX_PREAUTH_SESSIONS,
  MAX_SESSIONS,
  MESSAGE_WINDOW_MS,
  PING_MS,
  PONG_TIMEOUT_MS,
  TOPIC_CODES,
  ATTACH_CODE,
  SCOPE_CODE,
  RELEASE_CODE,
  authFrame,
  encodeAttach,
  encodeEnvelope,
  encodeScope,
  encodeRelease,
  isLiveTopic,
  parseClientMessage,
  parseEnvelope,
  topicOfCode,
  watchFrame,
} from './domain/liveWire.js';

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

export {
  clearBinding,
  declareModel,
  parseCapabilities,
  setBinding,
} from './application/configBinding.js';
export type { ConfigEdit } from './application/configBinding.js';

export { CONTEXT_HEADING, composeBrief } from './application/composeBrief.js';

export { checkTool } from './application/checkTool.js';
export type { CheckToolRequest } from './application/checkTool.js';

export { runDoctor } from './application/doctor.js';
export type { DoctorReport } from './application/doctor.js';

export { dispatchSwarm } from './application/dispatchSwarm.js';
export type {
  DispatchDeps,
  DispatchEvent,
  DispatchResult,
  MemberOutcome,
} from './application/dispatchSwarm.js';

export { withinRoot } from './domain/scope.js';
export { binDir, pawHome } from './domain/pawHome.js';
export type { HomeEnv } from './domain/pawHome.js';

export { applyInit } from './application/applyInit.js';
export { configPathFor, planInit } from './domain/initScaffold.js';
export type { FileWrite, InitPlan } from './domain/initScaffold.js';

export {
  PAW_CONFIG_VERSION,
  PAW_STAMP_KEY,
  hashConfig,
  inspectConfig,
  mergeConfig,
  resolveInit,
  stampConfig,
} from './domain/initConfig.js';
export type {
  InitConflict,
  InitMode,
  InitOutcome,
  PawStamp,
} from './domain/initConfig.js';

export type {
  ClockPort,
  ConfigDocumentPort,
  ConfigPort,
  FileReaderPort,
  FileSystemPort,
  GateRunner,
  HostConnector,
  ModelPort,
  ModelRequest,
  ModelResponse,
  PresenterPort,
  ProcessPort,
  ProcessResult,
  ProcessRunOptions,
  RecentRoutesPort,
  SecretPort,
  StorePort,
} from './ports/index.js';

export type {
  AttachState,
  BudgetSummary,
  ClientMessage,
  RunSettings,
  DaemonStatus,
  HostInfo,
  HostProcess,
  LiveEnvelope,
  LiveError,
  LiveTopic,
  LiveTopicMap,
  LogEntry,
  MemberView,
  MemberViewState,
  PawSnapshot,
  PlanSlice,
  PlansSlice,
  RailChrome,
  RunProgress,
  TreeNode,
} from './contracts.js';
