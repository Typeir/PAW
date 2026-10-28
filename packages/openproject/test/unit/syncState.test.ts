/**
 * @fileoverview Cover {@link parseSyncState} and {@link serializeSyncState}: a blank sidecar, a
 * round trip, and the refusals for invalid JSON and a wrong shape.
 *
 * @module @paw/openproject/test/unit/syncState
 */

import { describe, expect, it } from 'vitest';
import { parseSyncState, serializeSyncState, STATE_FILE } from '../../src/domain/syncState.js';

describe('parseSyncState', () => {
  it('reads a blank sidecar as no state', () => {
    expect(parseSyncState(' \n')).toEqual({ ok: true, state: null });
  });

  it('round-trips a state, cursor or null', () => {
    for (const cursor of ['2026-10-28T14:12:29.596Z', null]) {
      const state = { baseUrl: 'http://localhost:18080', project: 'paw-spike', cursor };
      expect(parseSyncState(serializeSyncState(state))).toEqual({ ok: true, state });
    }
  });

  it('ends the serialized state in a newline', () => {
    expect(serializeSyncState({ baseUrl: 'b', project: 'p', cursor: null }).endsWith('}\n')).toBe(true);
  });

  it('refuses invalid JSON naming the file', () => {
    const parsed = parseSyncState('{');
    expect(!parsed.ok && parsed.reason).toMatch(/^\.paw\/openproject\.sync\.json is not valid JSON: /);
  });

  it('refuses a state without string baseUrl and project and a string or null cursor', () => {
    for (const text of ['[]', 'null', '{"baseUrl":"b","project":"p","cursor":7}', '{"baseUrl":"b","cursor":null}']) {
      expect(parseSyncState(text)).toEqual({
        ok: false,
        reason: `${STATE_FILE} needs a string baseUrl and project and a string or null cursor; delete it to force a full sync`,
      });
    }
  });
});
