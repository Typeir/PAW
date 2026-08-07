/**
 * PAW CLI Test Config
 *
 * @fileoverview Runs the CLI's unit and E2E tiers and enforces 100% coverage on
 * the four axes, per CONSTRAINTS.md Constraint 1. `src/main.ts` is excluded for
 * cause: it is the process shell (stdin, dynamic import, `process.exit`), covered
 * by the E2E suites (`decide` and `cli`) that spawn it as a child process. Live
 * model I/O no longer lives here — it is the daemon's SDK egress, reached through
 * `openLiveHerd`. The pure modules the CLI composes — `render`, `presenter`,
 * `format` — carry the coverage number and are unit-tested to 100%; the shared
 * registry builder lives in `@paw/core`.
 *
 * @module @paw/cli/vitest.config
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
