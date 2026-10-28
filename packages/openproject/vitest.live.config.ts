/**
 * PAW OpenProject Live Test Config
 *
 * @fileoverview Live project: runs the module against a real `openproject/openproject:17`
 * container through Docker. `npm run test:live` only; no other gate includes it.
 *
 * @module @paw/openproject/vitest.live.config
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
