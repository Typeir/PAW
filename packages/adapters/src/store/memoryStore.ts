/**
 * PAW In-Memory Store Adapter
 *
 * @fileoverview {@link StorePort} keep violation in memory. Back tests. Define reference
 * semantics sql.js and native adapter match: session-scoped row plus project-scoped
 * (null-session) row visible to all, resolve by file. Hold no persistence; process
 * restart forget everything.
 *
 * @module @paw/adapters/store/memoryStore
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { StorePort, Violation } from '@paw/core';

/**
 * One stored row: violation plus scope and resolution state.
 *
 * @interface Row
 * @property {Violation} violation - The violation, with assigned id.
 * @property {string | null} sessionId - Owning session, null for project scope.
 * @property {boolean} resolved - Whether resolved.
 */
interface Row {
  violation: Violation;
  sessionId: string | null;
  resolved: boolean;
}

/**
 * Create in-memory store.
 *
 * @returns {StorePort} Store backed by in-memory array.
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

    async outstanding(): Promise<Violation[]> {
      return rows.filter((r) => !r.resolved).map((r) => r.violation);
    },

    async prune(filePath: string | null): Promise<number> {
      let cleared = 0;
      for (const r of rows) {
        if (!r.resolved && (filePath === null || r.violation.filePath === filePath)) {
          r.resolved = true;
          cleared += 1;
        }
      }
      return cleared;
    },
  };
}
