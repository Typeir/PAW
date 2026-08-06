/**
 * PAW Installer Test Config
 *
 * @fileoverview Enforces 100% coverage on the four axes, per CONSTRAINTS.md
 * Constraint 1. `src/main.ts` (the argv + real-adapter shell) and `src/adapters/**`
 * (the OS writes: the filesystem, and the PowerShell `[Environment]` call that
 * persists the user PATH) are excluded — they are the I/O boundary. Everything
 * that decides WHAT to do — shell/OS detection, the PATH-edit planner, repo-root
 * discovery, the init scaffold, and the port-driven apply — is pure and tested.
 *
 * @module @paw/installer/vitest.config
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
      exclude: ['src/main.ts', 'src/index.ts', 'src/ports.ts', 'src/adapters/**'],
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
