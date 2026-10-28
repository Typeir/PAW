/**
 * @fileoverview Cover the public API: `backend` names the three files and the sync entry point.
 *
 * @module @paw/openproject/test/unit/index
 */

import { describe, expect, it } from 'vitest';
import { backend, sync } from '../../src/index.js';

describe('backend', () => {
  it('names the env, sidecar, and task document under .paw and exposes sync', () => {
    expect(backend.files).toEqual({
      env: '.paw/openproject.backend.env',
      state: '.paw/openproject.sync.json',
      tasks: '.paw/tasks.json',
    });
    expect(backend.sync).toBe(sync);
  });
});
