import { defineConfig } from 'vitest/config';

/**
 * Core test + coverage config. Thresholds 100 on all four axes, per CONSTRAINTS.md
 * Constraint 1.
 *
 * Exclusions are the types-only files: `src/ports/**` (port interfaces) and
 * `src/domain/event.ts` (canonical event and response types). TypeScript erases
 * them; no executable code to cover. Other exclusions carry the same
 * justification and are reviewed by the hexagonal gate.
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
