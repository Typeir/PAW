/**
 * PAW Daemon — Public API
 *
 * @fileoverview `pawd` as a library: start it in your own process with
 * {@link runDaemon} and the real {@link nodeRuntime}, or with a runtime of your
 * own in a test. The pure pieces it composes — host facts, process ownership,
 * snapshot assembly, routing — are exported too, because the CLI, the Electron
 * shell, and the test suite each need a different slice.
 *
 * @module @paw/daemon
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { readHostInfo } from './domain/host.js';
export type { OsLike, ProcLike } from './domain/host.js';

export { collectSubtree } from './infrastructure/process.js';

export { formatUptime } from './domain/snapshot.js';

export { LOG_CAPACITY, createLogRing } from './domain/logRing.js';
export type { LogRing } from './domain/logRing.js';

export { createBus } from './domain/bus.js';
export type { BusErrorReporter, LiveBus, LiveListener } from './domain/bus.js';

export {
  buildPlanSlice,
  composeSnapshot,
  createVersionedCache,
  emptyPlanSlice,
  idleBudget,
  idleRun,
} from './domain/cache.js';
export type { SnapshotParts, VersionedCache } from './domain/cache.js';

export { route } from './domain/router.js';
export type { HttpResponse, RouterDeps } from './domain/router.js';

export { IGNORED_DIRS, buildFileTree, findSubtree } from './domain/tree.js';
export type { FileEntry } from './domain/tree.js';

export {
  CONFIG_PATH,
  PLAN_SUFFIX,
  UnknownPlanError,
  discoverPlans,
  findConfig,
  selectPlan,
} from './domain/plans.js';

export {
  LOOPBACK,
  PROCESS_POLL_MS,
  REFUSING_MODEL,
  modelCount,
  runDaemon,
  toPlan,
  underRoot,
} from './serve.js';
export type {
  DaemonHandle,
  DaemonOptions,
  DaemonRuntime,
  Dispatcher,
  RunReport,
  ServerHandle,
  TlsMaterial,
} from './serve.js';

export {
  CA_WARN_DAYS,
  LEAF_DAYS,
  LEAF_RENEW_DAYS,
  caExpiringSoon,
  chromiumFingerprint,
  formatFingerprint,
  trustAdvice,
} from './domain/identity.js';
export type { IdentityAction, IdentityMeta } from './domain/identity.js';

export { identityNotice, loadIdentity, markTrusted } from './infrastructure/identityStore.js';
export type { IdentityIo, IdentityIssuer, ServerIdentity } from './infrastructure/identityStore.js';

export { identityPaths, pawHome } from './domain/pawHome.js';
export type { HomeEnv, IdentityPaths } from './domain/pawHome.js';

export { nodeIdentityIo, nodeServerIdentity } from './infrastructure/nodeIdentity.js';

export { TRUST_NICKNAME, planTrust, trustCommandLine } from './infrastructure/trustStore.js';
export type { TrustPlan, TrustStep } from './infrastructure/trustStore.js';

export { meterPort, toRunProgress, trackRun } from './run.js';
export type { MeteredPort, RunTracker } from './run.js';

export { openLiveHerd } from './infrastructure/model/openLiveHerd.js';
export type { LiveSdkRegistry } from './infrastructure/model/liveSdkRegistry.js';

export { createSessionRegistry } from './sessions.js';
export type { LiveSession, SessionRegistry, WsSessionPort } from './sessions.js';

export { decideUpgrade } from './infrastructure/security.js';
export type { UpgradeRefusal, UpgradeRequest } from './infrastructure/security.js';

export { BOOTSTRAP, nodeRuntime, walkFiles } from './nodeRuntime.js';
export { CONSOLE_PAGE_FILE, consolePage, resolveConsolePage } from './domain/consolePage.js';
