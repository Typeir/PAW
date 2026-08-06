import { defineConfig } from 'vitest/config';

/**
 * Core test + coverage config. The thresholds are 100 on all four axes, per
 * CONSTRAINTS.md Constraint 1: the build is red at 99.9, not at 80.
 *
 * The exclusions are the interfaces/types-only files — `src/ports/**` (the port
 * interfaces) and `src/domain/event.ts` (the canonical event and response types).
 * TypeScript erases them to nothing, so there is no executable code to cover.
 * Any other exclusion must carry the same kind of justification and is reviewed
 * by the hexagonal gate.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/ports/**', 'src/domain/event.ts', 'src/contracts.ts'],
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
