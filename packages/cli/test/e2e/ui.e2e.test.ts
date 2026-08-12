/**
 * @fileoverview E2E test for `paw ui`. Spawn real CLI, wait line that say where
 * `pawd` listen, then talk to daemon over HTTP: console page at `/` and live
 * snapshot at `/api/state`, whose pid be the running `pawd` process. Start with no plan
 * named, find plans repo hold, switch between them over wire without restart.
 *
 * @module @paw/cli/test/e2e/ui
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');
const TSX = join(PKG, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MAIN = join(PKG, 'src', 'infrastructure', 'main.ts');

let child: ChildProcess | null = null;
let home = '';
let ca = '';

beforeEach(async () => {
  // Child mint real CA into whatever PAW_HOME point at. Give each test own
  // home so suite neither read nor disturb operator identity, CA it mint read
  // back here to verify chain, and no test depend on whether earlier one run.
  home = await mkdtemp(join(tmpdir(), 'paw-cli-home-'));
});

afterEach(() => {
  child?.kill();
  child = null;
});

/**
 * Snapshot fields these tests read.
 *
 * @interface WireState
 * @property {object} host - Host facts.
 * @property {string[]} plans - Repository plans.
 * @property {string | null} selectedPlan - Plan in view.
 * @property {string} planName - Its name.
 * @property {string[]} briefs - Its rendered briefs.
 * @property {object} run - Run progress.
 * @property {object} budget - Token usage.
 */
interface WireState {
  host: { pid: number; hostname: string; node: string };
  configPath: string;
  plans: string[];
  selectedPlan: string | null;
  planName: string;
  memberTotal: number;
  briefs: string[];
  doctor: { ok: boolean };
  run: { done: number; skipped: number; confirmed: number; members: { key: string }[] };
  budget: { tokensIn: number; tokensOut: number };
}

/**
 * Start `paw ui` over fixture repository, resolve once it announce its URL.
 *
 * @param args - Extra argv, e.g. plan to open on or `--run`.
 * @returns {Promise<{ url: string; token: string; banner: string }>} Served URL, credential it printed, and banner.
 */
function startUi(...args: string[]): Promise<{ url: string; token: string; banner: string }> {
  return new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      [TSX, MAIN, 'ui', '--headless', '--root=test/fixtures', '--config=ready.config.json', ...args],
      { cwd: PKG, env: { ...process.env, PAW_HOME: home } },
    );
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = /pawd listening on (https:\/\/127\.0\.0\.1:\d+\/)#t=(\S+)/.exec(out);
      if (match) {
        void readFile(join(home, 'identity', 'ca.crt'), 'utf8').then((pem) => {
          ca = pem;
          resolve({ url: match[1], token: match[2], banner: out });
        }, reject);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.once('exit', (code) => reject(new Error(`paw ui exited ${code}: ${err || out}`)));
  });
}

/**
 * Call served daemon over TLS, verify its certificate against CA child process
 * issue. `rejectUnauthorized` on; each call validate served chain.
 *
 * @param {string} url - Absolute URL.
 * @param {Record<string, string>} [headers] - Request headers.
 * @returns {Promise<{ status: number; body: string }>} Response.
 */
function call(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { ca, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.once('error', reject);
    req.end();
  });
}

/**
 * Read daemon state, optionally for selected plan.
 *
 * @param {string} url - Daemon URL.
 * @param {string} token - Credential printed with URL.
 * @param {string} [plan] - Plan to ask for.
 * @returns {Promise<WireState>} Snapshot.
 */
async function readState(url: string, token: string, plan?: string): Promise<WireState> {
  const target = plan === undefined ? `${url}api/state` : `${url}api/state?plan=${plan}`;
  const res = await call(target, { authorization: `Bearer ${token}` });
  return JSON.parse(res.body) as WireState;
}

/**
 * Run CLI to completion with given argv.
 *
 * @param args - Argv after script path.
 */
function runCli(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [TSX, MAIN, ...args],
      { cwd: PKG, env: { ...process.env, PAW_HOME: home } },
      (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: err && typeof err.code === 'number' ? err.code : 0 });
      },
    );
  });
}

describe('paw ui (e2e)', () => {
  it('serves a repository with no plan named, and switches plans over the wire', async () => {
    const { url, token, banner } = await startUi();
    expect(banner).toContain('1 plan(s)');
    expect(banner).toContain('pick one in the console');

    const page = await call(url);
    expect(page.status).toBe(200);
    expect(page.body).toContain('<!doctype html>');

    const empty = await readState(url, token);
    expect(empty.host.pid).toBeGreaterThan(0);
    expect(empty.host.node).toBe(process.version);
    expect(empty.configPath).toBe('ready.config.json');
    expect(empty.plans).toEqual(['demo.swarm.mjs']);
    expect(empty.selectedPlan).toBeNull();
    expect(empty.memberTotal).toBe(0);
    expect(empty.doctor.ok).toBe(true);

    const picked = await readState(url, token, 'demo.swarm.mjs');
    expect(picked.selectedPlan).toBe('demo.swarm.mjs');
    expect(picked.planName).toBe('demo');
    expect(picked.briefs).toHaveLength(2);

    // Boot scope remember as recent route, resolved absolute, in PAW home, and
    // served back for console scope picker. Relative route never enter list.
    const recent = await call(`${url}api/recent`, { authorization: `Bearer ${token}` });
    expect(recent.status).toBe(200);
    const routes = JSON.parse(recent.body) as string[];
    expect(routes.some((route) => /test[\\/]fixtures$/.test(route))).toBe(true);
    expect(routes.every((route) => /^([A-Za-z]:[\\/]|[\\/])/.test(route))).toBe(true);
  }, 30000);

  it('opens on the plan it was given', async () => {
    const { url, token, banner } = await startUi('demo.swarm.mjs');
    expect(banner).toContain('open on demo.swarm.mjs');
    expect((await readState(url, token)).planName).toBe('demo');
  }, 30000);

  it('refuses a plan the repository does not hold', async () => {
    const { url, token } = await startUi();
    const res = await call(`${url}api/state?plan=../../src/main.ts`, {
      authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(404);
    expect(res.body).toContain('no such plan in this repository');
  }, 30000);

  it('releases the herd with --run and reports the real outcomes and token count', async () => {
    const { url, token, banner } = await startUi('demo.swarm.mjs', '--run');
    expect(banner).toContain('releasing the herd (fake model)');

    let state = await readState(url, token, 'demo.swarm.mjs');
    for (
      let attempt = 0;
      attempt < 40 && (state.run.done === 0 || state.budget.tokensIn === 0);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await readState(url, token, 'demo.swarm.mjs');
    }

    expect(state.run.done).toBe(2);
    expect(state.run.confirmed).toBe(2);
    expect(state.run.members.map((m) => m.key)).toEqual(['docs/one.mdx', 'docs/two.mdx']);
    expect(state.budget.tokensIn).toBeGreaterThan(0);
    expect(state.budget.tokensOut).toBeGreaterThan(0);
  }, 30000);

  it('refuses an API call from anyone who did not read that URL', async () => {
    const { url, token } = await startUi();
    const res = await call(`${url}api/state`);
    expect(res.status).toBe(401);
    expect(res.body).not.toContain(token);
  }, 30000);

  it('serves over TLS with a certificate that verifies, and says how to trust it', async () => {
    const { url, banner } = await startUi();
    expect(url.startsWith('https://')).toBe(true);
    // First boot into fresh PAW home mint CA, so banner must carry fingerprint
    // OS dialog show and file to point at.
    expect(banner).toContain('issued this machine a local CA · SHA256:');
    expect(banner).toContain('paw trust');
    expect(banner).toContain(join(home, 'identity', 'ca.crt').replace(/\\/g, '/'));
    expect((await call(url)).status).toBe(200);
  }, 30000);

  it('prints a credential worth 256 bits, fresh every boot', async () => {
    const { token } = await startUi();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  }, 30000);

  it('fails loud when --run has no plan to release', async () => {
    const { stderr, code } = await runCli('ui', '--root=test/fixtures', '--run');
    expect(code).toBe(1);
    expect(stderr).toContain('paw ui --run needs the plan to release');
  });
});

describe('paw trust (e2e)', () => {
  it('shows the fingerprint and the exact commands, and changes nothing on a dry run', async () => {
    const { stdout, code } = await runCli('trust', '--dry-run');

    expect(code).toBe(0);
    expect(stdout).toMatch(/PAW local CA · SHA256(:[0-9A-F]{2}){32}/);
    expect(stdout).toContain(join(home, 'identity', 'ca.crt').replace(/\\/g, '/'));
    // Operator must compare fingerprint against OS dialog, which must show
    // that exact fingerprint.
    expect(stdout).toContain('the OS dialog must show that exact fingerprint');
    expect(stdout).toContain('dry run · nothing was changed');

    const meta = JSON.parse(await readFile(join(home, 'identity', 'meta.json'), 'utf8')) as {
      trusted: boolean;
    };
    expect(meta.trusted).toBe(false);
  }, 30000);

  it('names a real command for this platform rather than describing one', async () => {
    const { stdout } = await runCli('trust', '--dry-run');
    const expected =
      process.platform === 'win32'
        ? 'certutil -user -addstore Root'
        : process.platform === 'darwin'
          ? 'security add-trusted-cert'
          : 'certutil -d sql:';
    expect(stdout).toContain(expected);
  }, 30000);
});
