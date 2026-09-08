/**
 * PAW Connectors Barrel Test
 *
 * @fileoverview Import public barrel, cover re-exports. Assert every shipped
 * connector reachable from package entry under name config select it by.
 *
 * @module @paw/connectors/test/index
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { claudeHooksConnector, copilotHooksConnector } from '../src/index.js';

describe('@paw/connectors barrel', () => {
  it('exposes the copilot-hooks connector by its config name', () => {
    expect(copilotHooksConnector.name).toBe('copilot-hooks');
    expect(typeof copilotHooksConnector.toEvent).toBe('function');
    expect(typeof copilotHooksConnector.fromResponse).toBe('function');
  });

  it('exposes the claude-hooks connector by its config name', () => {
    expect(claudeHooksConnector.name).toBe('claude-hooks');
    expect(typeof claudeHooksConnector.toEvent).toBe('function');
    expect(typeof claudeHooksConnector.fromResponse).toBe('function');
  });
});
