/**
 * PAW CLI Test Config
 *
 * @fileoverview Runs the CLI's unit and E2E tiers and enforces 100% coverage on
 * the four axes, per CONSTRAINTS.md Constraint 1. `src/main.ts`, `src/stdin.ts`,
 * and `src/commands/**` are excluded for cause: they are the process shell (stdin,
 * dynamic import, sockets, spawn, `process.exit`) that `main.ts` composes, covered
 * by the E2E suites (`decide`, `cli`, `ui`) that spawn the CLI as a child process.
 * The split from one `main.ts` into per-command modules is organisation, not a
 * change in what is shell — the exclusion follows the code. Live model I/O no
 * longer lives here — it is the daemon's SDK egress, reached through
 * `openLiveHerd`. The pure modules the CLI composes — `render`, `presenter`,
 * `format`, `context` — carry the coverage number and are unit-tested to 100%.
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
      exclude: ['src/main.ts', 'src/stdin.ts', 'src/commands/**'],
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
