/**
 * PAW Connectors Barrel Test
 *
 * @fileoverview Imports the public barrel so its re-exports are covered, and
 * asserts the reference connector is reachable from the package entry with the
 * name a config selects it by.
 *
 * @module @paw/connectors/test/index
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { copilotHooksConnector } from '../src/index.js';

describe('@paw/connectors barrel', () => {
  it('exposes the copilot-hooks connector by its config name', () => {
    expect(copilotHooksConnector.name).toBe('copilot-hooks');
    expect(typeof copilotHooksConnector.toEvent).toBe('function');
    expect(typeof copilotHooksConnector.fromResponse).toBe('function');
  });
});
