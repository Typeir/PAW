/**
 * PAW OpenProject Task Document
 *
 * @fileoverview Writes work records into the paw-agile task document
 * (`{ "tasks": [{ "id", "title", "fields" }], "edges": [["parent", "child"]] }`). The module owns
 * tasks with an `op-<digits>` id and edges between two such tasks; every other task, edge, and
 * top-level key is kept as found. Output is deterministic: owned tasks by numeric id, owned edges
 * by child then parent id.
 *
 * @module @paw/openproject/domain/taskDocument
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { WorkRecord } from './workPackage.js';

/**
 * Repository-relative path of the task document.
 *
 * @constant
 */
export const TASKS_FILE = '.paw/tasks.json';

/**
 * An id this module owns.
 *
 * @constant
 */
const OWNED_ID = /^op-(\d+)$/;

/**
 * `full` replaces every owned task and edge; `delta` upserts the given records and removes none.
 */
export type WriteMode = 'full' | 'delta';

/**
 * A parsed document split into the entries this module owns and everything else.
 *
 * @interface TaskDocument
 * @property {Record<string, unknown>} root - The parsed document object.
 * @property {unknown[]} foreignTasks - Task entries not owned, document order.
 * @property {Map<string, unknown>} ownedTasks - Owned task entries by id.
 * @property {unknown[]} foreignEdges - Edge entries not owned, document order.
 * @property {Array<readonly [string, string]>} ownedEdges - Owned edges.
 */
export interface TaskDocument {
  readonly root: Record<string, unknown>;
  readonly foreignTasks: unknown[];
  readonly ownedTasks: Map<string, unknown>;
  readonly foreignEdges: unknown[];
  readonly ownedEdges: Array<readonly [string, string]>;
}

/**
 * Outcome of parsing a document.
 */
export type DocumentParse =
  | { readonly ok: true; readonly document: TaskDocument }
  | { readonly ok: false; readonly reason: string };

/**
 * A written document.
 *
 * @interface DocumentWrite
 * @property {string} text - Document text: 2-space JSON, trailing newline.
 * @property {number} written - Distinct records written.
 * @property {number} removed - Owned tasks removed.
 */
export interface DocumentWrite {
  readonly text: string;
  readonly written: number;
  readonly removed: number;
}

/**
 * The numeric part of an owned id.
 *
 * @param {string} id - An id matching {@link OWNED_ID}.
 * @returns {number} The work package id.
 */
function ordinal(id: string): number {
  return Number((OWNED_ID.exec(id) as RegExpExecArray)[1]);
}

/**
 * Whether a value is an id this module owns.
 *
 * @param {unknown} id - Any value.
 * @returns {boolean} True for a string matching {@link OWNED_ID}.
 */
function isOwned(id: unknown): id is string {
  return typeof id === 'string' && OWNED_ID.test(id);
}

/**
 * The owned task id of a task entry.
 *
 * @param {unknown} entry - One element of `tasks`.
 * @returns {string | null} The id, or null when the entry is not an owned task.
 */
function ownedTaskId(entry: unknown): string | null {
  const id = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined;
  return isOwned(id) ? id : null;
}

/**
 * Whether an edge entry is a `[parent, child]` pair of owned ids.
 *
 * @param {unknown} entry - One element of `edges`.
 * @returns {boolean} True for an owned edge.
 */
function isOwnedEdge(entry: unknown): entry is readonly [string, string] {
  return Array.isArray(entry) && entry.length === 2 && isOwned(entry[0]) && isOwned(entry[1]);
}

/**
 * Parse and split a document.
 *
 * @param {string} text - Document text; blank is an empty document.
 * @returns {DocumentParse} The document, or a refusal naming the file.
 */
export function parseTaskDocument(text: string): DocumentParse {
  let parsed: unknown;
  try {
    parsed = text.trim() === '' ? {} : JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `${TASKS_FILE} is not valid JSON: ${String(err)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `${TASKS_FILE} is not a JSON object` };
  }
  const root = parsed as Record<string, unknown>;
  for (const key of ['tasks', 'edges']) {
    if (root[key] !== undefined && !Array.isArray(root[key])) {
      return { ok: false, reason: `${TASKS_FILE} has a "${key}" that is not an array` };
    }
  }
  const document: TaskDocument = { root, foreignTasks: [], ownedTasks: new Map(), foreignEdges: [], ownedEdges: [] };
  for (const entry of (root.tasks ?? []) as unknown[]) {
    const id = ownedTaskId(entry);
    if (id === null) {
      document.foreignTasks.push(entry);
    } else {
      document.ownedTasks.set(id, entry);
    }
  }
  for (const entry of (root.edges ?? []) as unknown[]) {
    if (isOwnedEdge(entry)) {
      document.ownedEdges.push(entry);
    } else {
      document.foreignEdges.push(entry);
    }
  }
  return { ok: true, document };
}

/**
 * Edges ordered by child id, then parent id.
 *
 * @param {Array<readonly [string, string]>} edges - Owned edges.
 * @returns {Array<readonly [string, string]>} A sorted copy.
 */
function sortEdges(edges: Array<readonly [string, string]>): Array<readonly [string, string]> {
  return [...edges].sort(
    ([leftParent, leftChild], [rightParent, rightChild]) =>
      ordinal(leftChild) - ordinal(rightChild) || ordinal(leftParent) - ordinal(rightParent),
  );
}

/**
 * Write records into a parsed task document.
 *
 * @param {TaskDocument} found - Parsed current document.
 * @param {readonly WorkRecord[]} records - Records to write; a later duplicate id wins.
 * @param {WriteMode} mode - Full replacement or delta upsert.
 * @returns {DocumentWrite} The new text and counts.
 */
export function writeRecords(found: TaskDocument, records: readonly WorkRecord[], mode: WriteMode): DocumentWrite {
  const incoming = new Map(records.map((record) => [record.id, record]));
  const tasks = mode === 'full' ? new Map<string, unknown>() : new Map(found.ownedTasks);
  const kept = mode === 'full' ? [] : found.ownedEdges.filter(([, child]) => !incoming.has(child));
  const edges: Array<readonly [string, string]> = [...kept];
  for (const record of incoming.values()) {
    tasks.set(record.id, { id: record.id, title: record.title, fields: record.fields });
    if (record.parent !== null) {
      edges.push([record.parent, record.id]);
    }
  }
  const removed = [...found.ownedTasks.keys()].filter((id) => !tasks.has(id)).length;
  const ordered = [...tasks.keys()].sort((left, right) => ordinal(left) - ordinal(right));
  const document = {
    ...found.root,
    tasks: [...found.foreignTasks, ...ordered.map((id) => tasks.get(id))],
    edges: [...found.foreignEdges, ...sortEdges(edges)],
  };
  return { text: `${JSON.stringify(document, null, 2)}\n`, written: incoming.size, removed };
}
