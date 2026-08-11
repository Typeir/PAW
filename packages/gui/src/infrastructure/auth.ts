/**
 * PAW Console credential
 *
 * @fileoverview Console grab daemon per-boot token. Also make token unreadable.
 *
 * Daemon print URL with token in **fragment** — `#t=…` — for reason: fragment
 * never go to server, never hit access log, never ride in `Referer`. Page take
 * token from `location.hash`, copy into `sessionStorage` (per-tab, per-origin,
 * survive reload), then rewrite address bar. Credential no sit in URL operator
 * might copy, screenshot, or bookmark.
 *
 * Tab with no token not retry tab. It lock out, and say so. Guessing no work
 * for 256-bit credential.
 *
 * @module @paw/gui/infrastructure/auth
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Fragment parameter daemon print token in.
 */
export const TOKEN_PARAM = 't';

/**
 * Where adopted token live for rest of tab's life.
 */
export const TOKEN_STORAGE_KEY = 'paw.token';

/**
 * Slice of `sessionStorage` console need. Take as seam so adoption rules test
 * without browser. Page served where storage throw (sandboxed frame, hardened
 * profile) degrade, not fail boot.
 *
 * @interface TokenStorage
 * @property {(key: string) => string | null} getItem - Read stored value.
 * @property {(key: string, value: string) => void} setItem - Store value.
 */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Slice of `window` token adoption read and rewrite.
 *
 * @interface AuthWindow
 * @property {{ hash: string; pathname: string; search: string }} location - Current address.
 * @property {{ replaceState: (data: unknown, unused: string, url: string) => void }} history - Strip credential from address bar.
 * @property {TokenStorage} [sessionStorage] - Per-tab storage, absent in exotic contexts.
 */
export interface AuthWindow {
  readonly location: { readonly hash: string; readonly pathname: string; readonly search: string };
  readonly history: { replaceState(data: unknown, unused: string, url: string): void };
  readonly sessionStorage?: TokenStorage;
}

/**
 * Token carried in URL fragment, if one there. Fragment parse as parameter list
 * so carry more than one key later, no change way token found.
 *
 * @param {string} hash - The `location.hash`, with or without leading `#`.
 * @returns {string | null} The token, or null.
 */
export function tokenFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') {
    return null;
  }
  const token = new URLSearchParams(raw).get(TOKEN_PARAM);
  return token === null || token === '' ? null : token;
}

/**
 * Take token out address bar, put in tab.
 *
 * Fragment token win, strip from URL now. Else reuse token tab already adopt —
 * that make reload work. Storage refuse write not fatal. Token return, use for
 * page's life. Only reload need printed URL again.
 *
 * @param {AuthWindow} win - Window to read.
 * @returns {string | null} Token tab should present, or null.
 */
export function adoptToken(win: AuthWindow): string | null {
  const fresh = tokenFromHash(win.location.hash);
  if (fresh === null) {
    try {
      return win.sessionStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }
  try {
    win.sessionStorage?.setItem(TOKEN_STORAGE_KEY, fresh);
  } catch {
    // Refuse write cost reload, not session.
  }
  win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`);
  return fresh;
}
