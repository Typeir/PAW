/**
 * PAW OpenProject Unit Test Config
 *
 * @fileoverview Unit gate: hand-written fixtures, no network, 100% coverage on the four axes.
 * The Docker-backed live project is `vitest.live.config.ts` and never runs here.
 *
 * @module @paw/openproject/vitest.config
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
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
