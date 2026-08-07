/**
 * PAW Adapters Test Config
 *
 * @fileoverview Runs the adapter tests and enforces 100% coverage on the four
 * axes, per CONSTRAINTS.md Constraint 1. Every adapter here is unit-testable —
 * the process adapter against real short-lived Node processes, the model
 * adapters against injected fakes, the stores against real engines in memory.
 * The thin real `@github/copilot-sdk` wiring is intentionally not in this
 * package; it is a separate `SessionRun` the daemon provides, so nothing here
 * needs the SDK.
 *
 * One reviewed exclusion, marked `c8 ignore` at its site in
 * `store/sql/nodeSqliteDriver.ts`: the dynamic `import('node:sqlite')` that
 * loads the native engine. Coverage of that line is a property of the machine
 * rather than of the code — the engine is blocked outright on some managed
 * hosts, which is the whole reason a second WASM engine exists — so requiring
 * it would make the suite pass or fail on where it ran. The driver it returns
 * is bound to an injected database and is covered to 100% by a double, so the
 * exclusion buys the import statement and nothing else.
 *
 * @module @paw/adapters/vitest.config
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      reporter: ['text', 'json-summary'],
    },
  },
});
