/**
 * PAW GUI Test Config
 *
 * @fileoverview Runs the GUI's three tiers in jsdom and enforces 100% coverage
 * on the four axes, per CONSTRAINTS.md Constraint 1. `src/main.tsx` is excluded,
 * and the exclusion is justified: it is the browser boot shell (`document`,
 * `fetch`, `createRoot`), whose only job is to mount the `ConsoleApp` this suite
 * renders directly. `src/index.ts` is the public barrel — re-exports with no
 * behaviour of their own — and `src/domain/console.types.ts` is types only,
 * excluded exactly as core excludes its contracts and ports.
 *
 * @module @paw/gui/vitest.config
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/main.tsx', 'src/index.ts', 'src/domain/console.types.ts'],
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
