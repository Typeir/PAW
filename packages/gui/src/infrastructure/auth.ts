/**
 * PAW Console Credential
 *
 * @fileoverview How the console comes to hold the daemon's per-boot token, and
 * how it stops holding it in a place anyone can read.
 *
 * The daemon prints its URL with the token in the **fragment** — `#t=…` — for a
 * specific reason: a fragment is never sent to a server, never lands in an
 * access log, and never rides along in a `Referer`. The page takes it from
 * `location.hash`, copies it into `sessionStorage` (per-tab, per-origin, and it
 * survives a reload), and then rewrites the address bar so the credential is not
 * sitting in a URL the operator might copy, screenshot, or bookmark.
 *
 * A tab with no token is not a tab that retries: it is locked out, and says so.
 * Guessing is not a recovery strategy for a 256-bit credential.
 *
 * @module @paw/gui/infrastructure/auth
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * The fragment parameter the daemon prints the token in.
 */
export const TOKEN_PARAM = 't';

/**
 * Where the adopted token lives for the rest of the tab's life.
 */
export const TOKEN_STORAGE_KEY = 'paw.token';

/**
 * The slice of `sessionStorage` the console needs. Taken as a seam so the
 * adoption rules are unit-tested without a browser, and so a page served in a
 * context where storage throws (a sandboxed frame, a hardened profile) degrades
 * instead of failing to boot.
 *
 * @interface TokenStorage
 * @property {(key: string) => string | null} getItem - Read a stored value.
 * @property {(key: string, value: string) => void} setItem - Store a value.
 */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The slice of `window` the token adoption reads and rewrites.
 *
 * @interface AuthWindow
 * @property {{ hash: string; pathname: string; search: string }} location - The current address.
 * @property {{ replaceState: (data: unknown, unused: string, url: string) => void }} history - Used to strip the credential from the address bar.
 * @property {TokenStorage} [sessionStorage] - Per-tab storage, absent in exotic contexts.
 */
export interface AuthWindow {
  readonly location: { readonly hash: string; readonly pathname: string; readonly search: string };
  readonly history: { replaceState(data: unknown, unused: string, url: string): void };
  readonly sessionStorage?: TokenStorage;
}

/**
 * The token carried in a URL fragment, if there is one. The fragment is parsed
 * as a parameter list so it can carry more than one key later without changing
 * how the token is found.
 *
 * @param {string} hash - The `location.hash`, with or without its leading `#`.
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
 * Take the token out of the address bar and into the tab.
 *
 * A fragment token wins and is immediately stripped from the URL; otherwise the
 * one this tab already adopted is reused, which is what makes a reload work. A
 * storage that refuses to be written is not fatal — the token is returned and
 * used for this page's life, and only a reload would need the printed URL again.
 *
 * @param {AuthWindow} win - The window to read.
 * @returns {string | null} The token this tab should present, or null.
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
    // A storage that refuses the write costs a reload, not a session.
  }
  win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`);
  return fresh;
}
