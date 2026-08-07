/**
 * PAW Adapters — Public API
 *
 * @fileoverview The driven adapters that implement `@paw/core`'s ports. Each
 * imports `@paw/core` for the interface it fulfils; none is imported by `core`.
 * Consumers pick the adapters they want and wire them to ports at their
 * composition root.
 *
 * @module @paw/adapters
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { createNodeFileReader, resolveInRoot } from './file/nodeFileReader.js';
export { createNodeFs } from './file/nodeFs.js';
export { createNodeProcess } from './process/nodeProcess.js';
export { createMemoryStore } from './store/memoryStore.js';
export { createSqlStore } from './store/sql/sqlStore.js';
export { STORE_SCHEMA_SQL } from './store/sql/schema.js';
export type { SqlDriver, SqlRow, SqlValue } from './store/sql/driver.js';
export {
  DEFAULT_STORE_ENGINE,
  ENGINE_CONFIG_KEY,
  STORE_ENGINES,
  resolveStoreEngine,
  serialiseEngineChoice,
} from './store/sql/engine.js';
export type { EngineEnv, StoreEngine } from './store/sql/engine.js';
export {
  createNodeSqliteDriver,
  loadNodeSqliteCtor,
} from './store/sql/nodeSqliteDriver.js';
export type {
  NodeSqliteCtor,
  NodeSqliteDatabase,
  NodeSqliteStatement,
} from './store/sql/nodeSqliteDriver.js';
export { createSqlJsDriver } from './store/sql/sqlJsDriver.js';
export type {
  SqlJsDatabase,
  SqlJsExecResult,
  SqlJsPersist,
} from './store/sql/sqlJsDriver.js';
export { createCopilotSdkModel } from './model/copilotSdk.js';
export type { SessionRun } from './model/copilotSdk.js';
export { createFakeModel } from './model/fakeModel.js';
export type { FakeModel } from './model/fakeModel.js';
