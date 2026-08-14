/**
 * PAW Console Endpoint Record
 *
 * @fileoverview Where the repo's console daemon is reachable. A booting daemon
 * records `{url, token, fingerprint, pid}` to `.paw/console.endpoint.json`;
 * a later `paw ui` reads it, probes `/api/state` with the token over TLS
 * pinned to the recorded fingerprint, and attaches instead of booting a
 * second daemon. A stale record fails the probe and is overwritten by the
 * next boot. The token at rest has the same trust level as the rest of
 * `.paw/`: local, gitignored.
 *
 * @module @paw/daemon/infrastructure/consoleEndpoint
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname, join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import type { DispatchEvent } from '@paw/core';

/**
 * A recorded console daemon.
 *
 * @interface ConsoleEndpoint
 * @property {string} url - Console base URL, e.g. `https://127.0.0.1:8971/`.
 * @property {string} token - Per-boot bearer credential.
 * @property {string} fingerprint - Leaf certificate fingerprint, PAW `SHA256:AA:..` form.
 * @property {number} pid - Daemon process id, for display.
 */
export interface ConsoleEndpoint {
  readonly url: string;
  readonly token: string;
  readonly fingerprint: string;
  readonly pid: number;
}

/**
 * Endpoint file inside a repo.
 *
 * @param {string} root - Repository root.
 * @returns {string} `<root>/.paw/console.endpoint.json`.
 */
export function consoleEndpointPath(root: string): string {
  return join(root, '.paw', 'console.endpoint.json');
}

/**
 * Record a booted daemon. Overwrites any earlier record. Filesystem failures
 * are swallowed: recording is a convenience, never boot-fatal.
 *
 * @param {string} root - Repository root.
 * @param {ConsoleEndpoint} endpoint - The daemon.
 */
export function recordConsoleEndpoint(root: string, endpoint: ConsoleEndpoint): void {
  try {
    const file = consoleEndpointPath(root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(endpoint, null, 2)}\n`, 'utf8');
  } catch {}
}

/**
 * Read the recorded endpoint, or null when missing, corrupt, or incomplete.
 *
 * @param {string} root - Repository root.
 * @returns {ConsoleEndpoint | null} The record, or null.
 */
export function readConsoleEndpoint(root: string): ConsoleEndpoint | null {
  try {
    const parsed = JSON.parse(
      readFileSync(consoleEndpointPath(root), 'utf8'),
    ) as Partial<ConsoleEndpoint>;
    if (
      typeof parsed.url === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.fingerprint === 'string' &&
      typeof parsed.pid === 'number'
    ) {
      return { url: parsed.url, token: parsed.token, fingerprint: parsed.fingerprint, pid: parsed.pid };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether the recorded daemon answers. One `GET /api/state` with the bearer
 * token; the served certificate must match the recorded fingerprint — a pin,
 * no trust-store lookup. Anything else — timeout, refused socket, wrong
 * certificate, non-2xx — is a dead or foreign endpoint.
 *
 * @param {ConsoleEndpoint} endpoint - The record to probe.
 * @param {number} [timeoutMs] - Probe budget.
 * @returns {Promise<boolean>} True when the daemon is live and its own.
 */
export function probeConsoleEndpoint(endpoint: ConsoleEndpoint, timeoutMs = 1500): Promise<boolean> {
  return pinnedRequest(endpoint, 'GET', 'api/state', undefined, timeoutMs);
}

/**
 * One dispatch event from an external herd, addressed to a run.
 *
 * @interface RunEventReport
 * @property {string} id - Run id, stable across the herd's events.
 * @property {string} at - Run start time, ISO.
 * @property {DispatchEvent} event - The dispatch event.
 */
export interface RunEventReport {
  readonly id: string;
  readonly at: string;
  readonly event: DispatchEvent;
}

/**
 * Report one external-herd event to the recorded daemon, so its console shows
 * the run. Fire-and-forget grade: any failure answers false and the herd runs
 * on unobserved.
 *
 * @param {ConsoleEndpoint} endpoint - The recorded daemon.
 * @param {RunEventReport} report - The event to fold.
 * @param {number} [timeoutMs] - Request budget.
 * @returns {Promise<boolean>} True when the daemon accepted it.
 */
export function postRunReport(
  endpoint: ConsoleEndpoint,
  report: RunEventReport,
  timeoutMs = 1500,
): Promise<boolean> {
  return pinnedRequest(endpoint, 'POST', 'api/run/report', JSON.stringify(report), timeoutMs);
}

/**
 * One HTTPS exchange with the recorded daemon: bearer token, certificate
 * pinned to the recorded fingerprint, own timer — node's request `timeout`
 * option does not fire during a stalled TLS handshake. Anything but a 2xx
 * from the pinned certificate answers false.
 *
 * @param {ConsoleEndpoint} endpoint - The recorded daemon.
 * @param {string} method - HTTP method.
 * @param {string} path - Path under the base URL.
 * @param {string | undefined} body - JSON body for writes.
 * @param {number} timeoutMs - Request budget.
 * @returns {Promise<boolean>} True on a pinned 2xx.
 */
function pinnedRequest(
  endpoint: ConsoleEndpoint,
  method: string,
  path: string,
  body: string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const expected = endpoint.fingerprint.replace(/^SHA256:/, '');
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise(ok);
      }
    };
    const timer = setTimeout(() => {
      settle(false);
      req.destroy();
    }, timeoutMs);
    const req = request(
      `${endpoint.url}${path}`,
      {
        method,
        rejectUnauthorized: false,
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
      },
      (res) => {
        const leaf = (res.socket as TLSSocket).getPeerCertificate();
        res.resume();
        settle(
          res.statusCode !== undefined
            && res.statusCode >= 200
            && res.statusCode < 300
            && leaf.fingerprint256 === expected,
        );
      },
    );
    req.on('error', () => settle(false));
    req.end(body);
  });
}
