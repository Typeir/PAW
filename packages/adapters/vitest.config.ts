/**
 * PAW Adapters Test Config
 *
 * @fileoverview Runs the adapter tests and enforces 100% coverage on the four
 * axes, per CONSTRAINTS.md Constraint 1. Every adapter is unit-testable: the
 * process adapter against real short-lived Node processes, the model adapters
 * against injected fakes, the stores against real engines in memory. The
 * `@github/copilot-sdk` wiring is not in this package; it is a separate
 * `SessionRun` the daemon provides.
 *
 * One exclusion, marked `c8 ignore` in `store/sql/nodeSqliteDriver.ts`: the
 * dynamic `import('node:sqlite')` that loads the native engine, unavailable on
 * some managed hosts. The driver it returns binds to an injected database and is
 * covered to 100% by a double; the exclusion covers the import statement only.
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
