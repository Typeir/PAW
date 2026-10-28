/**
 * PAW OpenProject Pull
 *
 * @fileoverview Reads a project's work packages, subprojects included, over API v3 through an
 * injected fetch. Always sends `filters`: `[]` for a full sweep, since the default query drops
 * closed work packages, or an `updatedAt` range from the cursor for a delta. Pages of 100, by id.
 *
 * @module @paw/openproject/application/pull
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { BackendConfig } from '../domain/backendEnv.js';
import { recordOf, type WorkRecord } from '../domain/workPackage.js';

/**
 * Requested page size.
 *
 * @constant
 */
const PAGE_SIZE = 100;

/**
 * The part of a fetch response a pull reads.
 *
 * @interface FetchResponse
 * @property {number} status - HTTP status.
 * @property {() => Promise<string>} text - Body text.
 */
export interface FetchResponse {
  readonly status: number;
  text(): Promise<string>;
}

/**
 * A GET-only fetch; the global `fetch` satisfies it.
 */
export type FetchLike = (url: string, init: { readonly headers: Readonly<Record<string, string>> }) => Promise<FetchResponse>;

/**
 * Outcome of a pull.
 */
export type Pull =
  | {
      readonly ok: true;
      readonly records: readonly WorkRecord[];
      readonly refusals: readonly string[];
      readonly cursor: string | null;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * One page as read.
 *
 * @interface Page
 * @property {readonly unknown[]} elements - `_embedded.elements`.
 * @property {number} total - Elements across all pages.
 */
interface Page {
  readonly elements: readonly unknown[];
  readonly total: number;
}

/**
 * The `filters` query value.
 *
 * @param {string | null} since - Cursor, or null for a full sweep.
 * @returns {string} JSON filter array.
 */
function filtersOf(since: string | null): string {
  return JSON.stringify(since === null ? [] : [{ updatedAt: { operator: '<>d', values: [since, ''] } }]);
}

/**
 * A body's error text: the HAL error `message`, else the raw body.
 *
 * @param {string} body - Response body.
 * @returns {string} Message to surface.
 */
function errorText(body: string): string {
  try {
    const message = (JSON.parse(body) as { message?: unknown } | null)?.message;
    return typeof message === 'string' ? message : body;
  } catch {
    return body;
  }
}

/**
 * A body as a collection page, or null.
 *
 * @param {string} body - Response body.
 * @returns {Page | null} The page, or null when the body is not a collection.
 */
function pageOf(body: string): Page | null {
  let parsed: { total?: unknown; _embedded?: { elements?: unknown } } | null;
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return null;
  }
  const elements = parsed?._embedded?.elements;
  const total = parsed?.total;
  return Array.isArray(elements) && typeof total === 'number' ? { elements, total } : null;
}

/**
 * Fetch one page.
 *
 * @param {FetchLike} fetch - Fetch to use.
 * @param {BackendConfig} config - Backend connection.
 * @param {string} path - Collection path.
 * @param {string} query - Query string without `offset`.
 * @param {number} page - 1-based page number.
 * @returns {Promise<Page | string>} The page, or the refusal reason.
 */
async function fetchPage(
  fetch: FetchLike,
  config: BackendConfig,
  path: string,
  query: string,
  page: number,
): Promise<Page | string> {
  const label = `GET ${path} page ${page}`;
  let response: FetchResponse;
  let body: string;
  try {
    response = await fetch(`${config.baseUrl}${path}?${query}&offset=${page}`, {
      headers: { Accept: 'application/hal+json', Authorization: `Basic ${btoa(`apikey:${config.key}`)}` },
    });
    body = await response.text();
  } catch (err) {
    return `${label} failed: ${String(err)}`;
  }
  if (response.status < 200 || response.status > 299) {
    return `${label} returned ${response.status}: ${errorText(body)}`;
  }
  return pageOf(body) ?? `${label} returned no work package collection`;
}

/**
 * The newer of two ISO timestamps.
 *
 * @param {string | null} current - Newest so far, or null.
 * @param {string} candidate - Timestamp to compare.
 * @returns {string} The newer one.
 */
function newest(current: string | null, candidate: string): string {
  return current !== null && Date.parse(current) >= Date.parse(candidate) ? current : candidate;
}

/**
 * Pull every work package of the project, or those changed since the cursor.
 *
 * @param {FetchLike} fetch - Fetch to use.
 * @param {BackendConfig} config - Backend connection.
 * @param {string | null} since - Cursor, or null for a full sweep.
 * @returns {Promise<Pull>} Records, element refusals, and the next cursor (`since` when nothing changed), or a refusal.
 */
export async function pullWorkPackages(fetch: FetchLike, config: BackendConfig, since: string | null): Promise<Pull> {
  const path = `/api/v3/projects/${encodeURIComponent(config.project)}/work_packages`;
  const query = new URLSearchParams({
    filters: filtersOf(since),
    pageSize: String(PAGE_SIZE),
    sortBy: JSON.stringify([['id', 'asc']]),
  }).toString();
  const records: WorkRecord[] = [];
  const refusals: string[] = [];
  let cursor = since;
  let seen = 0;
  let page = 0;
  let read: Page | string;
  do {
    page += 1;
    read = await fetchPage(fetch, config, path, query, page);
    if (typeof read === 'string') {
      return { ok: false, reason: read };
    }
    for (const element of read.elements) {
      const parsed = recordOf(element);
      if (parsed.ok) {
        records.push(parsed.record);
        cursor = newest(cursor, parsed.record.updatedAt);
      } else {
        refusals.push(parsed.reason);
      }
    }
    seen += read.elements.length;
  } while (read.elements.length > 0 && seen < read.total);
  return { ok: true, records, refusals, cursor };
}
