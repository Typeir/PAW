/**
 * PAW Daemon Test Config
 *
 * @fileoverview Enforces 100% coverage on the four axes, per CONSTRAINTS.md
 * Constraint 1. `src/main.ts` is excluded: it is the I/O shell (a `node:http`
 * server, `ps-list`, dynamic import, the filesystem) whose only job is to gather
 * the real inputs and hand them to the pure `host`, `snapshot`, and `router` this
 * suite tests exhaustively.
 *
 * @module @paw/daemon/vitest.config
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
      exclude: ['src/main.ts', 'src/index.ts'],
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
