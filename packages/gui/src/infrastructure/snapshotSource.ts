/**
 * PAW Console Snapshot Source
 *
 * @fileoverview Where the console's data comes from, and the honest split
 * between the two cases. Served by `pawd`, the page fetches `/api/state` and
 * keeps fetching — every field is then real, read from the host at the moment of
 * the request. Opened as a self-contained artifact, the build injected a
 * snapshot on `window` and there is nothing to poll; the console says so rather
 * than pretending a frozen fixture is live. The transport is taken as a seam, so
 * this is unit-tested without a network and without jsdom's fetch.
 *
 * @module @paw/gui/infrastructure/snapshotSource
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawSnapshot, TreeNode } from '@paw/core';
import type { SnapshotSource } from '../application/hooks/useLiveRefresh.js';
import { adoptToken, type AuthWindow } from './auth.js';
import {
  createSocketFactory,
  liveUrl,
  type SocketFactory,
  type SocketWindow,
  type WebSocketConstructor,
} from './liveSocket.js';

/**
 * The slice of `Response` the source needs.
 *
 * @interface ResponseLike
 * @property {boolean} ok - Whether the status is 2xx.
 * @property {number} status - The HTTP status code.
 * @property {() => Promise<unknown>} json - The parsed body.
 */
export interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/**
 * The request options the source sets — headers only; the console never sends a
 * body, and a `GET`-only API needs nothing else.
 *
 * @interface RequestInitLike
 * @property {Record<string, string>} [headers] - Headers to send.
 */
export interface RequestInitLike {
  readonly headers?: Record<string, string>;
}

/**
 * The slice of `fetch` the source needs.
 */
export type FetchLike = (url: string, init?: RequestInitLike) => Promise<ResponseLike>;

/**
 * Wrap a transport so every request carries the daemon's token. Done once, at
 * the boundary, so no source, hook, or component ever handles the credential —
 * they cannot leak what they never see.
 *
 * @param {FetchLike} fetchFn - The underlying transport.
 * @param {string | null} token - The adopted token, or null when the tab has none.
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
 * The window fields the self-contained build writes.
 *
 * @interface PawWindow
 * @property {PawSnapshot} [__PAW_DATA__] - A snapshot injected by the static build.
 */
export interface PawWindow {
  __PAW_DATA__?: PawSnapshot;
}

/**
 * The daemon's state endpoint.
 */
export const STATE_URL = '/api/state';

/**
 * The daemon's repository tree endpoint.
 */
export const TREE_URL = '/api/tree';

/**
 * A source of repository file trees — `pawd`'s `/api/tree`.
 */
export type TreeSource = () => Promise<readonly TreeNode[]>;

/**
 * Build a source that reads the daemon's live state. A non-2xx response throws:
 * the caller renders the failure, and a stale console is never shown as fresh.
 *
 * @param {FetchLike} fetchFn - The transport.
 * @param {string} [url] - The endpoint to read.
 * @returns {SnapshotSource} A source that yields the current snapshot.
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
 * Build a source that reads the daemon's repository tree, optionally narrowed
 * to a directory inside it. Like the state source, a non-2xx response throws
 * rather than resolving to an empty tree that would read as "this repo has no
 * files".
 *
 * @param {FetchLike} fetchFn - The transport.
 * @param {string} [root] - A directory within the served tree to narrow to.
 * @returns {TreeSource} A source that yields the current tree.
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
 * What the shell needs to mount: the snapshot to boot from, the source to keep
 * it live, and the tree the file selector browses — both null for the static
 * artifact, which has no daemon behind it and therefore no repository to show.
 *
 * @interface Boot
 * @property {PawSnapshot} snapshot - The initial snapshot.
 * @property {SnapshotSource | null} source - The polling source used while the socket is down, or null when static.
 * @property {SocketFactory | null} connect - Opens the live socket, or null when static or not on https.
 * @property {TreeSource | null} treeSource - The tree source, or null when static.
 * @property {string | null} token - The credential this tab adopted, or null.
 */
export interface Boot {
  readonly snapshot: PawSnapshot;
  readonly source: SnapshotSource | null;
  readonly connect: SocketFactory | null;
  readonly treeSource: TreeSource | null;
  readonly token: string | null;
}

/**
 * Resolve the console's data: the injected snapshot when the build supplied one,
 * otherwise the daemon's live state. A live boot adopts the token from the
 * address bar first, and every transport it hands back is already carrying it.
 *
 * @param {PawWindow & AuthWindow} win - The window to read the injected snapshot and credential from.
 * @param {FetchLike} fetchFn - The transport for the live case.
 * @returns {Promise<Boot>} The snapshot, its sources, and the adopted token.
 */
export async function boot(
  win: PawWindow & AuthWindow & SocketWindow,
  fetchFn: FetchLike,
  ctor: WebSocketConstructor | undefined,
): Promise<Boot> {
  const injected = win.__PAW_DATA__;
  if (injected) {
    return { snapshot: injected, source: null, connect: null, treeSource: null, token: null };
  }
  const token = adoptToken(win);
  const authed = authedFetch(fetchFn, token);
  const source = createHttpSource(authed);
  const url = liveUrl(win);
  return {
    snapshot: await source(null),
    source,
    // No socket when the page is not on https or the environment has none: the
    // console then polls, which is slower and correct, rather than downgrading
    // the wire to something a credential should never travel over.
    connect: url === null || ctor === undefined ? null : createSocketFactory(url, ctor),
    treeSource: createTreeSource(authed),
    token,
  };
}
