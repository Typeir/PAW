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
export { createNodeProcess } from './process/nodeProcess.js';
export { createMemoryStore } from './store/memoryStore.js';
export { createCopilotSdkModel } from './model/copilotSdk.js';
export type { SessionRun } from './model/copilotSdk.js';
export { createFakeModel } from './model/fakeModel.js';
export type { FakeModel } from './model/fakeModel.js';
