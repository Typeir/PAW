/**
 * PAW OpenProject Work Package
 *
 * @fileoverview Maps one API v3 work package to a work-model record: id `op-<id>`, the parent
 * from `_links.parent`, and a field bag of link titles. `storyPoints` lands in `points`, the
 * field paw-agile rolls up; `url` is the work package's page on the instance.
 *
 * @module @paw/openproject/domain/workPackage
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Prefix of every task id this module writes.
 *
 * @constant
 */
export const ID_PREFIX = 'op-';

/**
 * Links whose `title` is copied into the field bag under the same name.
 *
 * @constant
 */
const TITLED_LINKS = ['type', 'status', 'project', 'sprint', 'assignee'] as const;

/**
 * One work package as the work model stores it.
 *
 * @interface WorkRecord
 * @property {string} id - Task id, `op-<id>`.
 * @property {string} title - Subject.
 * @property {string | null} parent - Parent task id, or null for a root.
 * @property {string} updatedAt - ISO timestamp of the last server change.
 * @property {Readonly<Record<string, unknown>>} fields - Field bag.
 */
export interface WorkRecord {
  readonly id: string;
  readonly title: string;
  readonly parent: string | null;
  readonly updatedAt: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * Outcome of mapping one element.
 */
export type RecordParse =
  | { readonly ok: true; readonly record: WorkRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * The task id of a work package.
 *
 * @param {number} id - Work package id.
 * @returns {string} `op-<id>`.
 */
export function taskId(id: number): string {
  return `${ID_PREFIX}${id}`;
}

/**
 * A value as a plain object, or null.
 *
 * @param {unknown} value - Any value.
 * @returns {Record<string, unknown> | null} The object, or null for a non-object or an array.
 */
function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * One link's property, or undefined.
 *
 * @param {Record<string, unknown>} links - The `_links` object.
 * @param {string} name - Link name.
 * @param {string} key - `href` or `title`.
 * @returns {unknown} The property.
 */
function linkProperty(links: Record<string, unknown>, name: string, key: string): unknown {
  return objectOf(links[name])?.[key];
}

/**
 * The parent task id `_links.parent` names.
 *
 * @param {Record<string, unknown>} links - The `_links` object.
 * @returns {string | null} Parent task id, or null when the href names no work package.
 */
function parentOf(links: Record<string, unknown>): string | null {
  const href = linkProperty(links, 'parent', 'href');
  const match = typeof href === 'string' ? /\/work_packages\/(\d+)$/.exec(href) : null;
  return match === null ? null : taskId(Number(match[1]));
}

/**
 * The field bag of a work package.
 *
 * @param {Record<string, unknown>} element - The work package.
 * @param {Record<string, unknown>} links - Its `_links` object.
 * @param {string} baseUrl - Instance origin, no trailing slash.
 * @returns {Record<string, unknown>} Source, ids, web URL, link titles, and numeric story points.
 */
function fieldsOf(
  element: Record<string, unknown>,
  links: Record<string, unknown>,
  baseUrl: string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    source: 'openproject',
    sourceId: element.id,
    url: `${baseUrl}/work_packages/${String(element.id)}`,
    updatedAt: element.updatedAt,
  };
  if (typeof element.displayId === 'string') {
    fields.displayId = element.displayId;
  }
  for (const name of TITLED_LINKS) {
    const title = linkProperty(links, name, 'title');
    if (typeof title === 'string') {
      fields[name] = title;
    }
  }
  if (typeof element.storyPoints === 'number') {
    fields.points = element.storyPoints;
  }
  return fields;
}

/**
 * The work-model record of one collection element.
 *
 * @param {unknown} value - One element of `_embedded.elements`.
 * @param {string} baseUrl - Instance origin, no trailing slash; prefixes the `url` field.
 * @returns {RecordParse} The record, or a refusal when the id, subject, or updatedAt is missing.
 */
export function recordOf(value: unknown, baseUrl: string): RecordParse {
  const element = objectOf(value);
  if (
    element === null ||
    typeof element.id !== 'number' ||
    typeof element.subject !== 'string' ||
    typeof element.updatedAt !== 'string'
  ) {
    return {
      ok: false,
      reason: `work package without a numeric id, subject, and updatedAt: ${JSON.stringify(value)}`,
    };
  }
  const links = objectOf(element._links) ?? {};
  return {
    ok: true,
    record: {
      id: taskId(element.id),
      title: element.subject,
      parent: parentOf(links),
      updatedAt: element.updatedAt,
      fields: fieldsOf(element, links, baseUrl),
    },
  };
}
