import { defineConfig } from 'vitest/config';

/**
 * PAW Agile test + coverage config. Thresholds 100 on all four axes, per
 * CONSTRAINTS.md Constraint 1. No exclusions: the package is pure domain.
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
      reporter: ['text', 'json-summary'],
    },
  },
});
