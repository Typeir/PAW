/**
 * PAW TUI Test Config
 *
 * @fileoverview Runs the TUI's unit and E2E tiers and enforces 100% coverage on
 * the four axes, per CONSTRAINTS.md Constraint 1. `src/main.ts` is excluded, and
 * the exclusion is justified: it is the process shell (stdin raw mode, dynamic
 * import, `process.exit`), covered by `test/e2e/tui.e2e.test.ts`, which spawns it
 * with piped input. The pure `app` (reducer) and `screen` (renderer) carry the
 * coverage number and the regression snapshots.
 *
 * @module @paw/tui/vitest.config
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
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
