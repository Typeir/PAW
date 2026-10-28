/**
 * PAW OpenProject Live Instance
 *
 * @fileoverview Drives the `compose.yaml` instance for the live project: requires a running
 * Docker engine, starts the container, waits for API v3, runs the two Rails steps the API cannot
 * do, and calls the API with a minted token. Never logs the token.
 *
 * @module @paw/openproject/test/live/instance
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Instance origin.
 *
 * @constant
 */
export const BASE_URL = 'http://localhost:18081';

/**
 * Compose file path.
 *
 * @constant
 */
const COMPOSE = fileURLToPath(new URL('./compose.yaml', import.meta.url));

/**
 * Longest wait for API v3 after `up`, in ms. A first boot initialises and seeds the database.
 *
 * @constant
 */
const BOOT_DEADLINE_MS = 840_000;

/**
 * Run `docker compose` against the live compose file.
 *
 * @param {readonly string[]} args - Arguments after `-f <compose>`.
 * @returns {string} Stdout.
 * @throws {Error} When docker exits non-zero; the message carries its stderr.
 */
function compose(args: readonly string[]): string {
  return execFileSync('docker', ['compose', '-f', COMPOSE, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Throw unless a Docker engine answers.
 *
 * @throws {Error} Naming the fix when `docker info` fails.
 */
export function requireDocker(): void {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`test:live needs a running Docker engine; start Docker Desktop and rerun. docker info: ${String(err)}`);
  }
}

/**
 * HTTP status of `GET /api/v3`, or 0 when the connection fails.
 *
 * @returns {Promise<number>} The status.
 */
async function apiStatus(): Promise<number> {
  return fetch(`${BASE_URL}/api/v3`).then(
    (response) => response.status,
    () => 0,
  );
}

/**
 * Start the container and wait until API v3 answers 200 or 401.
 *
 * @returns {Promise<void>} Resolves when the API is up.
 * @throws {Error} When the deadline passes, naming the last status.
 */
export async function startInstance(): Promise<void> {
  compose(['up', '-d']);
  const deadline = Date.now() + BOOT_DEADLINE_MS;
  let status = await apiStatus();
  while (status !== 200 && status !== 401) {
    if (Date.now() > deadline) {
      throw new Error(`${BASE_URL}/api/v3 still answers ${status} after ${BOOT_DEADLINE_MS} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    status = await apiStatus();
  }
}

/**
 * Run one of this directory's Ruby scripts through `rails runner` and return its marker line.
 *
 * @param {string} script - Script file name in this directory.
 * @param {readonly string[]} args - Script arguments.
 * @param {string} marker - Prefix of the line to return.
 * @returns {string} The text after the marker.
 * @throws {Error} When the script fails or prints no marker line.
 */
export function railsRunner(script: string, args: readonly string[], marker: string): string {
  compose(['cp', fileURLToPath(new URL(`./${script}`, import.meta.url)), `openproject:/tmp/${script}`]);
  const out = compose(['exec', '-T', '-w', '/app', 'openproject', 'bundle', 'exec', 'rails', 'runner', `/tmp/${script}`, ...args]);
  const line = out.split(/\r?\n/).find((text) => text.startsWith(`${marker} `));
  if (line === undefined) {
    throw new Error(`rails runner ${script} printed no ${marker} line`);
  }
  return line.slice(marker.length + 1);
}

/**
 * An API v3 client authenticated with one token.
 *
 * @param {string} token - API token.
 * @returns {(method: string, path: string, body?: unknown) => Promise<any>} Call returning parsed JSON, or null for 204.
 */
export function apiClient(token: string): (method: string, path: string, body?: unknown) => Promise<any> {
  const authorization = `Basic ${Buffer.from(`apikey:${token}`).toString('base64')}`;
  return async (method, path, body) => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { authorization, accept: 'application/hal+json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (response.status >= 300) {
      throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 400)}`);
    }
    return text === '' ? null : JSON.parse(text);
  };
}
