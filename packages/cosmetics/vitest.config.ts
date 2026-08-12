import { defineConfig } from 'vitest/config';

/**
 * Cosmetics test + coverage config. Thresholds 100 on all four axes, per
 * CONSTRAINTS.md Constraint 1. Everything here is pure data and string
 * builders; nothing is excluded.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
