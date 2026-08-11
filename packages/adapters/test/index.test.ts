/**
 * PAW Adapters Barrel Test
 *
 * @fileoverview Import public barrel, cover re-exports. Assert each adapter
 * factory reachable from package entry.
 *
 * @module @paw/adapters/test/index
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import * as adapters from '../src/index.js';

describe('@paw/adapters barrel', () => {
  it('exposes every adapter factory from the package entry', () => {
    expect(typeof adapters.createNodeFileReader).toBe('function');
    expect(typeof adapters.createNodeProcess).toBe('function');
    expect(typeof adapters.createMemoryStore).toBe('function');
    expect(typeof adapters.createCopilotSdkModel).toBe('function');
    expect(typeof adapters.createFakeModel).toBe('function');
  });
});
