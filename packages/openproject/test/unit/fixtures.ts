/**
 * PAW OpenProject Unit Fixtures
 *
 * @fileoverview Hand-written OpenProject API v3 shapes, modelled on a local
 * `openproject/openproject:17` holding synthetic data. No captured payloads.
 *
 * @module @paw/openproject/test/unit/fixtures
 */

/**
 * Optional parts of a work package fixture.
 *
 * @interface WorkPackageOptions
 * @property {number} [parent] - Parent work package id; absent gives a null parent link.
 * @property {string} [type] - Type title; default `Task`.
 * @property {string} [status] - Status title; default `New`.
 * @property {string} [sprint] - Sprint title; absent gives a sprint link without a title.
 * @property {string} [assignee] - Assignee name; absent omits the link.
 * @property {number | null} [storyPoints] - Story points; default null.
 * @property {string} [updatedAt] - ISO timestamp; default `2026-10-28T14:12:22.200Z`.
 */
export interface WorkPackageOptions {
  readonly parent?: number;
  readonly type?: string;
  readonly status?: string;
  readonly sprint?: string;
  readonly assignee?: string;
  readonly storyPoints?: number | null;
  readonly updatedAt?: string;
}

/**
 * One work package in the API v3 HAL shape.
 *
 * @param {number} id - Work package id.
 * @param {string} subject - Subject line.
 * @param {WorkPackageOptions} [options] - Optional parts.
 * @returns {Record<string, unknown>} The work package.
 */
export function workPackage(id: number, subject: string, options: WorkPackageOptions = {}): Record<string, unknown> {
  return {
    _type: 'WorkPackage',
    id,
    displayId: String(id),
    subject,
    lockVersion: 0,
    updatedAt: options.updatedAt ?? '2026-10-28T14:12:22.200Z',
    storyPoints: options.storyPoints ?? null,
    _links: {
      self: { href: `/api/v3/work_packages/${id}`, title: subject },
      parent:
        options.parent === undefined
          ? { href: null }
          : { href: `/api/v3/work_packages/${options.parent}`, title: 'Parent' },
      type: { href: '/api/v3/types/1', title: options.type ?? 'Task' },
      status: { href: '/api/v3/statuses/1', title: options.status ?? 'New' },
      project: { href: '/api/v3/projects/4', title: 'Checkout' },
      sprint: options.sprint === undefined ? { href: null } : { href: '/api/v3/sprints/1', title: options.sprint },
      ...(options.assignee === undefined ? {} : { assignee: { href: '/api/v3/users/4', title: options.assignee } }),
    },
  };
}

/**
 * One page of a work package collection.
 *
 * @param {readonly unknown[]} elements - Elements on this page.
 * @param {number} [total] - Total across pages; default the page's element count.
 * @param {number} [page] - 1-based page number; default 1.
 * @param {number} [pageSize] - Page size the server applied; default 100.
 * @returns {Record<string, unknown>} The collection page.
 */
export function collection(
  elements: readonly unknown[],
  total: number = elements.length,
  page = 1,
  pageSize = 100,
): Record<string, unknown> {
  return { _type: 'Collection', total, count: elements.length, pageSize, offset: page, _embedded: { elements } };
}

/**
 * The backend env file of a test instance.
 */
export const ENV_TEXT = 'BASE_URL=http://localhost:18080/\nKEY=test-key\nPROJECT=paw-spike\n';
