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

export { readHostInfo } from './host.js';
export type { OsLike, ProcLike } from './host.js';

export { collectSubtree } from './process.js';

export { formatUptime } from './snapshot.js';

export { LOG_CAPACITY, createLogRing } from './logRing.js';
export type { LogRing } from './logRing.js';

export { createBus } from './bus.js';
export type { BusErrorReporter, LiveBus, LiveListener } from './bus.js';

export {
  buildPlanSlice,
  composeSnapshot,
  createVersionedCache,
  emptyPlanSlice,
  idleBudget,
  idleRun,
} from './cache.js';
export type { SnapshotParts, VersionedCache } from './cache.js';

export { route } from './router.js';
export type { HttpResponse, RouterDeps } from './router.js';

export { IGNORED_DIRS, buildFileTree, findSubtree } from './tree.js';
export type { FileEntry } from './tree.js';

export {
  CONFIG_PATH,
  PLAN_SUFFIX,
  UnknownPlanError,
  discoverPlans,
  findConfig,
  selectPlan,
} from './plans.js';

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
} from './identity.js';
export type { IdentityAction, IdentityMeta } from './identity.js';

export { identityNotice, loadIdentity, markTrusted } from './identityStore.js';
export type { IdentityIo, IdentityIssuer, ServerIdentity } from './identityStore.js';

export { identityPaths, pawHome } from './pawHome.js';
export type { HomeEnv, IdentityPaths } from './pawHome.js';

export { nodeIdentityIo, nodeServerIdentity } from './nodeIdentity.js';

export { TRUST_NICKNAME, planTrust, trustCommandLine } from './trustStore.js';
export type { TrustPlan, TrustStep } from './trustStore.js';

export { meterPort, toRunProgress, trackRun } from './run.js';
export type { MeteredPort, RunTracker } from './run.js';

export { openLiveHerd } from './model/openLiveHerd.js';
export type { LiveSdkRegistry } from './model/liveSdkRegistry.js';

export { createSessionRegistry } from './sessions.js';
export type { LiveSession, SessionRegistry, WsSessionPort } from './sessions.js';

export { decideUpgrade } from './security.js';
export type { UpgradeRefusal, UpgradeRequest } from './security.js';

export { BOOTSTRAP, nodeRuntime, walkFiles } from './nodeRuntime.js';
export { CONSOLE_PAGE_FILE, consolePage, resolveConsolePage } from './consolePage.js';
