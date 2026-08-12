/**
 * PAW Console Snapshot Source
 *
 * @fileoverview Console get data from here. Two case. Served by
 * `pawd`, page fetch `/api/state` and keep fetch — every field read from
 * host at moment of request. Open self-contained artifact, build inject snapshot
 * on `window`, nothing to poll. Transport passed in as parameter, unit-test
 * without network and without jsdom fetch.
 *
 * @module @paw/gui/infrastructure/snapshotSource
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawSnapshot, TreeNode } from '@paw/core';
import type { SnapshotSource } from '../application/hooks/useLiveRefresh.js';
import { adoptToken, type AuthWindow } from './auth.js';
import { createConfigClient, type ConfigClient } from './configClient.js';
import { createPlansClient, type PlansClient } from './plansClient.js';
import { createRecentClient, type RecentClient } from './recentClient.js';
import {
  createSocketFactory,
  liveUrl,
  type SocketFactory,
  type SocketWindow,
  type WebSocketConstructor,
} from './liveSocket.js';

/**
 * The slice of `Response` source need.
 *
 * @interface ResponseLike
 * @property {boolean} ok - Status be 2xx.
 * @property {number} status - The HTTP status code.
 * @property {() => Promise<unknown>} json - The parsed body.
 */
export interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/**
 * The request options source set — headers only; console never send body,
 * and `GET`-only API need nothing else.
 *
 * @interface RequestInitLike
 * @property {string} [method] - HTTP method; absent mean GET.
 * @property {string} [body] - Request body, for write.
 * @property {Record<string, string>} [headers] - Headers to send.
 */
export interface RequestInitLike {
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Record<string, string>;
}

/**
 * The slice of `fetch` source need.
 */
export type FetchLike = (url: string, init?: RequestInitLike) => Promise<ResponseLike>;

/**
 * Wrap transport so every request carry daemon token. Do once, at
 * boundary, so no source, hook, or component ever handle credential.
 *
 * @param {FetchLike} fetchFn - The underlying transport.
 * @param {string | null} token - The adopted token, or null when tab have none.
 * @returns {FetchLike} The authenticated transport.
 */
export function authedFetch(fetchFn: FetchLike, token: string | null): FetchLike {
  if (token === null) {
    return fetchFn;
  }
  return (url, init) =>
    fetchFn(url, {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${token}` },
    });
}

/**
 * The window fields self-contained build write.
 *
 * @interface PawWindow
 * @property {PawSnapshot} [__PAW_DATA__] - A snapshot static build inject.
 */
export interface PawWindow {
  __PAW_DATA__?: PawSnapshot;
}

/**
 * Daemon state endpoint.
 */
export const STATE_URL = '/api/state';

/**
 * Daemon repository tree endpoint.
 */
export const TREE_URL = '/api/tree';

/**
 * A source of repository file trees — `pawd` `/api/tree`.
 */
export type TreeSource = () => Promise<readonly TreeNode[]>;

/**
 * Build source that read daemon live state. Non-2xx response throw:
 * caller render failure, stale console never show as fresh.
 *
 * @param {FetchLike} fetchFn - The transport.
 * @param {string} [url] - The endpoint to read.
 * @returns {SnapshotSource} A source that yield current snapshot.
 */
export function createHttpSource(fetchFn: FetchLike, url: string = STATE_URL): SnapshotSource {
  return async (plan: string | null): Promise<PawSnapshot> => {
    const target = plan === null ? url : `${url}?plan=${encodeURIComponent(plan)}`;
    const response = await fetchFn(target);
    if (!response.ok) {
      throw new Error(`PAW console: ${target} responded ${response.status}`);
    }
    return (await response.json()) as PawSnapshot;
  };
}

/**
 * Build source that read daemon repository tree, optionally narrow
 * to directory inside it. Like state source, non-2xx response throw;
 * an empty tree would be misread as "this repo have no files".
 *
 * @param {FetchLike} fetchFn - The transport.
 * @param {string} [root] - A directory within served tree to narrow to.
 * @returns {TreeSource} A source that yield current tree.
 */
export function createTreeSource(fetchFn: FetchLike, root = ''): TreeSource {
  const url = root === '' ? TREE_URL : `${TREE_URL}?root=${encodeURIComponent(root)}`;
  return async (): Promise<readonly TreeNode[]> => {
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`PAW console: ${url} responded ${response.status}`);
    }
    return (await response.json()) as readonly TreeNode[];
  };
}

/**
 * What shell need to mount: snapshot to boot from, source to keep
 * it live, and tree file selector browse — both null for static
 * artifact, which have no daemon behind it and therefore no repository to show.
 *
 * @interface Boot
 * @property {PawSnapshot} snapshot - The initial snapshot.
 * @property {SnapshotSource | null} source - Polling source used while socket down, or null when static.
 * @property {SocketFactory | null} connect - Open live socket, or null when static or not on https.
 * @property {TreeSource | null} treeSource - Tree source, or null when static.
 * @property {ConfigClient | null} config - Binding editor client, or null when static.
 * @property {PlansClient | null} plans - Plan-file write client, or null when static.
 * @property {RecentClient | null} recent - Scope picker recent-routes client, or null when static.
 * @property {string | null} token - Credential this tab adopted, or null.
 */
export interface Boot {
  readonly snapshot: PawSnapshot;
  readonly source: SnapshotSource | null;
  readonly connect: SocketFactory | null;
  readonly treeSource: TreeSource | null;
  readonly config: ConfigClient | null;
  readonly plans: PlansClient | null;
  readonly recent: RecentClient | null;
  readonly token: string | null;
}

/**
 * Resolve console data: injected snapshot when build supply one,
 * otherwise daemon live state. Live boot adopt token from
 * address bar first, and every transport it hand back already carry it.
 *
 * @param {PawWindow & AuthWindow} win - Window to read injected snapshot and credential from.
 * @param {FetchLike} fetchFn - Transport for live case.
 * @returns {Promise<Boot>} Snapshot, its sources, and adopted token.
 */
export async function boot(
  win: PawWindow & AuthWindow & SocketWindow,
  fetchFn: FetchLike,
  ctor: WebSocketConstructor | undefined,
): Promise<Boot> {
  const injected = win.__PAW_DATA__;
  if (injected) {
    return {
      snapshot: injected,
      source: null,
      connect: null,
      treeSource: null,
      config: null,
      plans: null,
      recent: null,
      token: null,
    };
  }
  const token = adoptToken(win);
  const authed = authedFetch(fetchFn, token);
  const source = createHttpSource(authed);
  const url = liveUrl(win);
  return {
    snapshot: await source(null),
    source,
    // No socket when page not on https or environment have none: console then
    // poll. Credential never travel over a wire not bound to the daemon host.
    connect: url === null || ctor === undefined ? null : createSocketFactory(url, ctor),
    treeSource: createTreeSource(authed),
    config: createConfigClient(authed),
    plans: createPlansClient(authed),
    recent: createRecentClient(authed),
    token,
  };
}
