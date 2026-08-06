/**
 * PAW In-Memory Store Adapter
 *
 * @fileoverview A {@link StorePort} that keeps violations in memory. Useful as
 * the store a test drives, and as the reference semantics the sql.js and native
 * adapters must match: session-scoped rows plus project-scoped (null-session)
 * rows visible to everyone, resolution by file. Holds no persistence — a process
 * restart forgets everything, which is exactly right for a fake and for tests.
 *
 * @module @paw/adapters/store/memoryStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { StorePort, Violation } from '@paw/core';

/**
 * One stored row: the violation plus its scope and resolution state.
 *
 * @interface Row
 * @property {Violation} violation - The violation, with its assigned id.
 * @property {string | null} sessionId - Owning session, or null for project scope.
 * @property {boolean} resolved - Whether it has been resolved.
 */
interface Row {
  violation: Violation;
  sessionId: string | null;
  resolved: boolean;
}

/**
 * Create an in-memory store.
 *
 * @returns {StorePort} A store backed by an in-memory array.
 */
export function createMemoryStore(): StorePort {
  const rows: Row[] = [];
  let nextId = 1;

  return {
    async unresolvedFor(sessionId: string | null): Promise<Violation[]> {
      return rows
        .filter(
          (r) =>
            !r.resolved &&
            (r.sessionId === sessionId || r.sessionId === null),
        )
        .map((r) => r.violation);
    },

    async raise(
      violations: readonly Violation[],
      sessionId: string | null,
    ): Promise<void> {
      for (const v of violations) {
        rows.push({
          violation: { ...v, id: nextId },
          sessionId,
          resolved: false,
        });
        nextId += 1;
      }
    },

    async resolveForFile(
      filePath: string,
      sessionId: string | null,
    ): Promise<number> {
      let resolved = 0;
      for (const r of rows) {
        const scopeMatches =
          sessionId === null ? r.sessionId === null : r.sessionId === sessionId;
        if (!r.resolved && r.violation.filePath === filePath && scopeMatches) {
          r.resolved = true;
          resolved += 1;
        }
      }
      return resolved;
    },
  };
}
