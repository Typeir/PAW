/**
 * PAW Connectors Test Config
 *
 * @fileoverview Runs the connector tests and enforces 100% coverage on the four
 * axes, per CONSTRAINTS.md Constraint 1. No exclusions: a connector is pure
 * translation and is fully unit-testable with synthetic host payloads.
 *
 * @module @paw/connectors/vitest.config
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { defineConfig } from 'vitest/config';

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
