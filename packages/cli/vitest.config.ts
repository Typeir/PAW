/**
 * PAW CLI Test Config
 *
 * @fileoverview Runs the CLI's unit and E2E tiers and enforces 100% coverage on
 * the four axes, per CONSTRAINTS.md Constraint 1. Two files are excluded, each for
 * cause: `src/main.ts` is the process shell (stdin, dynamic import, `process.exit`),
 * covered by the E2E suites (`decide` and `cli`) that spawn it as a child process;
 * `src/deepseekRuntime.ts` is network I/O (a live model endpoint), proven by the
 * opt-in `deepseek` integration test rather than in-process v8. The pure modules
 * they compose — `render`, `presenter`, `format` — carry the coverage number and
 * are unit-tested to 100%; the shared registry builder lives in `@paw/core`.
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
      exclude: ['src/main.ts', 'src/deepseekRuntime.ts'],
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
