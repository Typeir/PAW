/**
 * Work Model Contract Tests
 *
 * @fileoverview The empty view every surface falls back to when a repository
 * has no module installed or no document to read.
 *
 * @module @paw/core/test/domain/workModel
 */

import { describe, expect, it } from 'vitest';
import { emptyWorkGraph } from '../../src/domain/workModel.js';

describe('emptyWorkGraph', () => {
  it('reports no rows and nothing recorded', () => {
    expect(emptyWorkGraph()).toEqual({ rows: [], refusals: [], loops: [], dangling: [] });
  });

  it('hands back a fresh value each call, so a caller cannot mutate the fallback', () => {
    expect(emptyWorkGraph()).not.toBe(emptyWorkGraph());
  });
});
