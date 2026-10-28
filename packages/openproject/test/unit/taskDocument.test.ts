/**
 * @fileoverview Cover {@link parseTaskDocument} and {@link writeRecords}: a blank document, a full
 * write replacing the module's tasks and edges, a delta upsert re-parenting one task, foreign
 * tasks, edges, and keys kept, duplicate records, multi-parent ordering, and the refusals for a
 * document that is not a task document.
 *
 * @module @paw/openproject/test/unit/taskDocument
 */

import { describe, expect, it } from 'vitest';
import { parseTaskDocument, TASKS_FILE, writeRecords, type WriteMode } from '../../src/domain/taskDocument.js';
import type { WorkRecord } from '../../src/domain/workPackage.js';

/**
 * A record with a minimal field bag.
 *
 * @param {number} id - Work package id.
 * @param {number | null} parent - Parent work package id, or null.
 * @param {string} [title] - Subject; default `WP <id>`.
 * @returns {WorkRecord} The record.
 */
function record(id: number, parent: number | null, title = `WP ${id}`): WorkRecord {
  return {
    id: `op-${id}`,
    title,
    parent: parent === null ? null : `op-${parent}`,
    updatedAt: '2026-10-28T14:00:00Z',
    fields: { source: 'openproject', sourceId: id },
  };
}

/**
 * Parse a document text and write records into it.
 *
 * @param {string} text - Document text.
 * @param {readonly WorkRecord[]} records - Records to write.
 * @param {WriteMode} mode - Write mode.
 * @returns {{ document: Record<string, unknown>; written: number; removed: number; text: string }} The parsed result and counts.
 */
function write(
  text: string,
  records: readonly WorkRecord[],
  mode: WriteMode,
): { document: Record<string, unknown>; written: number; removed: number; text: string } {
  const parsed = parseTaskDocument(text);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const out = writeRecords(parsed.document, records, mode);
  return { ...out, document: JSON.parse(out.text) as Record<string, unknown> };
}

const EXISTING = JSON.stringify({
  version: 1,
  tasks: [
    { id: 'local-epic', title: 'Local', fields: {} },
    { id: 'op-10', title: 'Old ten', fields: {} },
    { id: 'op-2', title: 'Old two', fields: {} },
    { id: 'op-3', title: 'Gone', fields: {} },
    'not a task',
    null,
  ],
  edges: [
    ['local-epic', 'op-2'],
    ['op-2', 'op-10'],
    ['op-2', 'op-3'],
    ['op-10', 'local-note'],
    'not an edge',
  ],
});

describe('writeRecords', () => {
  it('writes a blank document as a task document, tasks by numeric id, ending in a newline', () => {
    const out = write('  \n', [record(10, 2), record(2, null), record(9, 2)], 'full');
    expect(out).toMatchObject({ written: 3, removed: 0 });
    expect(out.text.endsWith('}\n')).toBe(true);
    expect(out.document).toEqual({
      tasks: [
        { id: 'op-2', title: 'WP 2', fields: { source: 'openproject', sourceId: 2 } },
        { id: 'op-9', title: 'WP 9', fields: { source: 'openproject', sourceId: 9 } },
        { id: 'op-10', title: 'WP 10', fields: { source: 'openproject', sourceId: 10 } },
      ],
      edges: [
        ['op-2', 'op-9'],
        ['op-2', 'op-10'],
      ],
    });
  });

  it('replaces the module tasks and edges on a full write and keeps everything else', () => {
    const out = write(EXISTING, [record(2, null, 'New two'), record(10, null)], 'full');
    expect(out).toMatchObject({ written: 2, removed: 1 });
    expect(out.document).toEqual({
      version: 1,
      tasks: [
        { id: 'local-epic', title: 'Local', fields: {} },
        'not a task',
        null,
        { id: 'op-2', title: 'New two', fields: { source: 'openproject', sourceId: 2 } },
        { id: 'op-10', title: 'WP 10', fields: { source: 'openproject', sourceId: 10 } },
      ],
      edges: [['local-epic', 'op-2'], ['op-10', 'local-note'], 'not an edge'],
    });
  });

  it('upserts on a delta write: re-parents one task, adds one, removes none, last duplicate wins', () => {
    const out = write(EXISTING, [record(3, 10, 'Moved'), record(11, 3), record(11, 10)], 'delta');
    expect(out).toMatchObject({ written: 2, removed: 0 });
    expect(out.document).toEqual({
      version: 1,
      tasks: [
        { id: 'local-epic', title: 'Local', fields: {} },
        'not a task',
        null,
        { id: 'op-2', title: 'Old two', fields: {} },
        { id: 'op-3', title: 'Moved', fields: { source: 'openproject', sourceId: 3 } },
        { id: 'op-10', title: 'Old ten', fields: {} },
        { id: 'op-11', title: 'WP 11', fields: { source: 'openproject', sourceId: 11 } },
      ],
      edges: [
        ['local-epic', 'op-2'],
        ['op-10', 'local-note'],
        'not an edge',
        ['op-10', 'op-3'],
        ['op-2', 'op-10'],
        ['op-10', 'op-11'],
      ],
    });
  });

  it('orders owned edges sharing a child by parent id', () => {
    const text = JSON.stringify({ tasks: [], edges: [['op-9', 'op-5'], ['op-1', 'op-5']] });
    expect(write(text, [], 'delta').document.edges).toEqual([
      ['op-1', 'op-5'],
      ['op-9', 'op-5'],
    ]);
  });
});

describe('parseTaskDocument', () => {
  it('refuses text that is not JSON, naming the file', () => {
    const parsed = parseTaskDocument('{');
    expect(!parsed.ok && parsed.reason).toMatch(/^\.paw\/tasks\.json is not valid JSON: /);
  });

  it('refuses a document that is not an object, or whose tasks or edges is not an array', () => {
    expect(parseTaskDocument('[]')).toEqual({ ok: false, reason: `${TASKS_FILE} is not a JSON object` });
    expect(parseTaskDocument('{"tasks":{}}')).toEqual({
      ok: false,
      reason: `${TASKS_FILE} has a "tasks" that is not an array`,
    });
    expect(parseTaskDocument('{"edges":7}')).toEqual({
      ok: false,
      reason: `${TASKS_FILE} has a "edges" that is not an array`,
    });
  });

  it('names the landing file under .paw', () => {
    expect(TASKS_FILE).toBe('.paw/tasks.json');
  });
});
