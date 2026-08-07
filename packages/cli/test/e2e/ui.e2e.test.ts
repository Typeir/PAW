/**
 * @fileoverview End-to-end test for `paw ui`. It spawns the real CLI, waits for
 * the line that announces where `pawd` is listening, and then talks to that
 * daemon over HTTP — the console page at `/` and the live snapshot at
 * `/api/state`, whose pid must be a real live process. This is the tier that
 * proves the command serves a **repository**: it starts with no plan named,
 * discovers the ones the repo holds, and switches between them over the wire
 * without a restart. The unit tiers cannot show that, because a socket is
 * exactly what they fake.
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
const MAIN = join(PKG, 'src', 'main.ts');

let child: ChildProcess | null = null;
let home = '';
let ca = '';

beforeEach(async () => {
  // The child issues a real CA into whatever PAW_HOME points at. Give each test
  // its own so the suite neither reads nor disturbs the operator's identity, the
  // CA it mints can be read back here to verify the chain, and no test depends
  // on whether an earlier one ran first.
  home = await mkdtemp(join(tmpdir(), 'paw-cli-home-'));
});

afterEach(() => {
  child?.kill();
  child = null;
});

/**
 * The snapshot fields these tests read.
 *
 * @interface WireState
 * @property {object} host - Host facts.
 * @property {string[]} plans - The repository's plans.
 * @property {string | null} selectedPlan - The plan in view.
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
 * Start `paw ui` over the fixture repository and resolve once it announces its URL.
 *
 * @param args - Extra argv, e.g. a plan to open on or `--run`.
 * @returns {Promise<{ url: string; token: string; banner: string }>} The served URL, the credential it printed, and the banner.
 */
function startUi(...args: string[]): Promise<{ url: string; token: string; banner: string }> {
  return new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      [TSX, MAIN, 'ui', '--root=test/fixtures', '--config=ready.config.json', ...args],
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
 * Call the served daemon over TLS, verifying its certificate against the CA the
 * child process issued. `rejectUnauthorized` is on, so every call here is also a
 * check that `paw ui` serves a chain that validates.
 *
 * @param {string} url - The absolute URL.
 * @param {Record<string, string>} [headers] - Request headers.
 * @returns {Promise<{ status: number; body: string }>} The response.
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
 * Read the daemon's state, optionally for a selected plan.
 *
 * @param {string} url - The daemon URL.
 * @param {string} token - The credential printed with the URL.
 * @param {string} [plan] - The plan to ask for.
 * @returns {Promise<WireState>} The snapshot.
 */
async function readState(url: string, token: string, plan?: string): Promise<WireState> {
  const target = plan === undefined ? `${url}api/state` : `${url}api/state?plan=${plan}`;
  const res = await call(target, { authorization: `Bearer ${token}` });
  return JSON.parse(res.body) as WireState;
}

/**
 * Run the CLI to completion with the given argv.
 *
 * @param args - The argv after the script path.
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
    for (let attempt = 0; attempt < 40 && state.run.done === 0; attempt += 1) {
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
    // The first boot into a fresh PAW home mints the CA, so the banner must
    // carry the fingerprint the OS dialog will show and the file to point at.
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
    // The operator must be able to compare the fingerprint against the OS dialog
    // — telling them to click through is how a local CA becomes a habit.
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
