/**
 * PAW CLI Test Config
 *
 * @fileoverview Runs the CLI's unit and E2E tiers; enforces 100% coverage on
 * the four axes, per CONSTRAINTS.md Constraint 1. `src/infrastructure/**` is
 * excluded: it is the process shell (stdin, dynamic import, sockets, spawn,
 * `process.exit`) — `main`, `stdin`, and the per-command modules `main` composes
 * — covered by the E2E suites (`decide`, `cli`, `ui`) that spawn the CLI as a
 * child process. Live model I/O is the daemon's SDK egress, reached through
 * `openLiveHerd`. The pure `domain` (render, format, context, …) and the seamed
 * `application` use-cases (hook, presenter, autostart, pawdStart, herdWriter)
 * carry coverage and are unit-tested to 100%.
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
      exclude: ['src/infrastructure/**'],
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
