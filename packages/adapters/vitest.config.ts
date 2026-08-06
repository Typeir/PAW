/**
 * PAW Adapters Test Config
 *
 * @fileoverview Runs the adapter tests and enforces 100% coverage on the four
 * axes, per CONSTRAINTS.md Constraint 1. No exclusions: every adapter here is
 * unit-testable — the process adapter against real short-lived Node processes,
 * the model adapters against injected fakes, the store in memory. The thin real
 * `@github/copilot-sdk` wiring is intentionally not in this package; it is a
 * separate `SessionRun` the daemon provides, so nothing here needs the SDK.
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
