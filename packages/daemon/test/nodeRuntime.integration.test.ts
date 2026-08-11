/**
 * Node Runtime Integration
 *
 * @fileoverview Integration adapter against a running system: real repo read
 * from disk, real config and plan read from it, real host process table, real
 * socket on ephemeral loopback port, real HTTP fetches. This tier proves
 * `/api/state` serves the host's own values — asserts served pid is this
 * process's pid, no fixture fake that — and that switching plans, editing a
 * plan, asking for one outside repository all behave over wire, not just
 * against fakes.
 *
 * @module @paw/daemon/test/nodeRuntime.integration
 */

import {
  CLOSE_AUTH,
  CLOSE_MALFORMED,
  CLOSE_SHUTDOWN,
  LIVE_SUBPROTOCOL,
  authFrame,
  parseEnvelope,
  watchFrame,
  type LiveEnvelope,
  type PawSnapshot,
  type TreeNode,
} from '@paw/core';
import WebSocket from 'ws';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createServer as createPlainServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { consolePage } from '../src/domain/consolePage.js';
import { issueCa } from '../src/infrastructure/nodeIdentity.js';
import {
  LOOPBACK_V6,
  bindLoopbackV6,
  bindServer,
  closeServer,
  createConsoleServer,
} from '../src/infrastructure/http/consoleServer.js';
import {
  boundPort,
  firstHeader,
  requestTarget,
  toHostProcess,
} from '../src/infrastructure/http/httpMessage.js';
import { BOOTSTRAP, nodeRuntime, walkFiles } from '../src/infrastructure/nodeRuntime.js';
import { runDaemon } from '../src/application/runDaemon.js';
import {
  REFUSING_MODEL,
  type DaemonHandle,
  type SocketHooks,
} from '../src/application/daemonContracts.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, 'fixtures');
const CONFIG = 'ready.config.json';
const PLAN = 'demo.swarm.mjs';
const PAGE = join(ROOT, 'page.html');

let daemon: DaemonHandle | null = null;
let previousHome: string | undefined;

/**
 * Socket hooks accept nothing. For tests that only exercise HTTP half of bound
 * server.
 */
const REFUSING_HOOKS: SocketHooks = {
  check: () => ({ status: 403, message: 'no live wire here' }),
  accept: () => ({ message: async () => undefined, closed: () => undefined }),
};

beforeAll(async () => {
  // Identity belong to machine, runtime write it into PAW's home. Point that at
  // temporary directory: these tests must issue real CA and lock down real key
  // file without touching operator's own.
  previousHome = process.env.PAW_HOME;
  process.env.PAW_HOME = await mkdtemp(join(tmpdir(), 'paw-home-'));
});

afterAll(() => {
  if (previousHome === undefined) {
    delete process.env.PAW_HOME;
    return;
  }
  process.env.PAW_HOME = previousHome;
});

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

/**
 * Start daemon over fixture repository.
 *
 * @param {string | undefined} planPath - Plan to open on, if any.
 * @returns {Promise<DaemonHandle>} Running daemon.
 */
async function serveFixtures(planPath?: string): Promise<DaemonHandle> {
  daemon = await runDaemon(
    { root: ROOT, configPath: CONFIG, planPath },
    nodeRuntime(PAGE),
  );
  return daemon;
}

/**
 * A response, in shape assertions below read it.
 *
 * @interface Wire
 * @property {number} status - Status code.
 * @property {{ get(name: string): string | null }} headers - Response headers.
 * @property {() => string} text - Body.
 * @property {() => unknown} json - Body, parsed.
 */
interface Wire {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): string;
  json(): unknown;
}

/**
 * Call daemon over TLS, verify its certificate against the CA it issued itself
 * from.
 *
 * `fetch` cannot do this job: it ignore a `ca` option, refuse to send forged
 * `Host` — the one header a DNS-rebinding page control and the first one
 * daemon's gates read. Go through `node:https` directly so chain genuinely
 * verified (`rejectUnauthorized` on by default). Every call here also verifies
 * the issued leaf.
 *
 * @param {string} url - Absolute URL.
 * @param {string} ca - CA certificate to verify against.
 * @param {{ headers?: Record<string, string>; method?: string; servername?: string }} [init] - Method, headers, and name to validate certificate against.
 * @returns {Promise<Wire>} Response.
 */
function call(
  url: string,
  ca: string,
  init: { headers?: Record<string, string>; method?: string; servername?: string } = {},
): Promise<Wire> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        ca,
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        ...(init.servername === undefined ? {} : { servername: init.servername }),
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: {
              get: (name: string) => {
                const value = res.headers[name.toLowerCase()];
                return value === undefined ? null : String(value);
              },
            },
            text: () => body,
            json: () => JSON.parse(body) as unknown,
          });
        });
      },
    );
    req.once('error', reject);
    req.end();
  });
}

/**
 * Call as authenticated console would.
 *
 * @param {string} url - Absolute URL.
 * @param {DaemonHandle} running - Daemon whose token and CA to use.
 * @param {{ headers?: Record<string, string>; method?: string }} [init] - Extra request options.
 * @returns {Promise<Wire>} Response.
 */
function authed(
  url: string,
  running: DaemonHandle,
  init: { headers?: Record<string, string>; method?: string; servername?: string } = {},
): Promise<Wire> {
  return call(url, running.identity.caCert, {
    ...init,
    headers: { authorization: `Bearer ${running.token}`, ...init.headers },
  });
}

describe('the daemon on the real runtime', () => {
  it('serves the console page and live host state over loopback', async () => {
    const running = await serveFixtures(PLAN);

    expect(running.url).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/$/);
    expect(running.plans).toContain(PLAN);
    expect(running.openedOn).toBe(PLAN);

    const page = await call(running.url, running.identity.caCert);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain(
      `wss://127.0.0.1:${running.port}`,
    );
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await page.text()).toContain('fixture page');

    const state = await authed(`${running.url}api/state`, running);
    expect(state.headers.get('cache-control')).toBe('no-store');
    const snapshot = (await state.json()) as PawSnapshot;

    expect(snapshot.host.pid).toBe(process.pid);
    expect(snapshot.host.hostname.length).toBeGreaterThan(0);
    expect(snapshot.host.node).toBe(process.version);
    expect(snapshot.host.rssBytes).toBeGreaterThan(0);
    expect(snapshot.processes.some((p) => p.pid === process.pid)).toBe(true);
    expect(snapshot.configPath).toBe(CONFIG);
    expect(snapshot.selectedPlan).toBe(PLAN);
    expect(snapshot.planName).toBe('demo');
    expect(snapshot.briefs).toHaveLength(2);
    expect(snapshot.doctor.roles.length).toBeGreaterThan(0);
    expect(snapshot.daemon.socket).toBe(`127.0.0.1:${running.port}`);
  });

  it('opens with no plan selected, and selects one over the wire', async () => {
    const running = await serveFixtures();

    const none = (await (await authed(`${running.url}api/state`, running)).json()) as PawSnapshot;
    expect(none.selectedPlan).toBeNull();
    expect(none.memberTotal).toBe(0);
    expect(none.plans).toContain(PLAN);

    const picked = (await (
      await authed(`${running.url}api/state?plan=${encodeURIComponent(PLAN)}`, running)
    ).json()) as PawSnapshot;
    expect(picked.selectedPlan).toBe(PLAN);
    expect(picked.planName).toBe('demo');
    expect(picked.briefs[1]).toContain('docs/two.mdx');
  });

  it('refuses a plan outside the repository with a 404, not an import', async () => {
    const running = await serveFixtures();
    const res = await authed(`${running.url}api/state?plan=../../src/main.ts`, running);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no such plan in this repository');
  });

  it('re-reads a plan after it changes on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paw-repo-'));
    const plan = join(root, 'live.swarm.mjs');
    const write = (name: string): Promise<void> =>
      writeFile(
        plan,
        `export default { name: '${name}', role: 'edit.apply', args: {}, members: 1,` +
          ` brief: () => 'hi', key: () => '${name}' };\n`,
        'utf8',
      );

    await write('before');
    daemon = await runDaemon({ root }, nodeRuntime(PAGE));
    expect((await daemon.snapshot('live.swarm.mjs')).planName).toBe('before');

    await new Promise((resolve) => setTimeout(resolve, 20));
    await write('after');
    expect((await daemon.snapshot('live.swarm.mjs')).planName).toBe('after');
  });

  it('serves the real repository tree, pruned of what nobody browses', async () => {
    daemon = await runDaemon(
      { root: join(here, '..'), configPath: join('test', 'fixtures', CONFIG) },
      nodeRuntime(PAGE),
    );
    const tree = (await (await authed(`${daemon.url}api/tree`, daemon)).json()) as TreeNode[];

    expect(tree.some((node) => node.name === 'src' && !node.isFile)).toBe(true);
    expect(tree.some((node) => node.name === 'package.json' && node.isFile)).toBe(true);
    expect(tree.some((node) => node.name === 'node_modules')).toBe(false);

    const src = tree.find((node) => node.name === 'src');
    expect(src?.children.map((child) => child.name)).toContain('index.ts');

    const narrowed = (await (await authed(`${daemon.url}api/tree?root=src`, daemon)).json()) as TreeNode[];
    expect(narrowed.map((node) => node.path)).toContain('src/index.ts');

    expect((await authed(`${daemon.url}api/tree?root=nope`, daemon)).status).toBe(404);
  });

  it('refuses an unauthenticated API call over the real socket', async () => {
    const running = await serveFixtures();
    const res = await call(`${running.url}api/state`, running.identity.caCert);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="pawd"');
    expect(res.text()).not.toContain(running.token);
  });

  it('refuses a rebinding Host over the real socket', async () => {
    const running = await serveFixtures();
    // Reaching Host gate at all take forcing client to validate against real
    // name, because TLS refuse the rebind first (asserted below). Gate still
    // tested: it the layer that survive if TLS ever relaxed.
    const res = await authed(`${running.url}api/state`, running, {
      headers: { host: 'evil.example' },
      servername: '127.0.0.1',
    });
    expect(res.status).toBe(400);
    expect(res.text()).toBe('bad host');
  });

  it('never completes a handshake for a name the certificate does not carry', async () => {
    const running = await serveFixtures();
    // This DNS rebinding, die at handshake: leaf valid for loopback only, so
    // page that re-points own name at 127.0.0.1 cannot establish session to
    // inherit an origin from.
    await expect(
      authed(`${running.url}api/state`, running, { headers: { host: 'evil.example' } }),
    ).rejects.toThrow(/does not match certificate's altnames/);
  });

  it('refuses a stranger’s Origin over the real socket', async () => {
    const running = await serveFixtures();
    const res = await authed(`${running.url}api/state`, running, {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('mints a fresh, unguessable token per boot', async () => {
    const first = await serveFixtures();
    const token = first.token;
    await first.close();
    const second = await serveFixtures();
    expect(second.token).not.toBe(token);
    expect(Buffer.from(second.token, 'base64url')).toHaveLength(32);
  });

  it('walks a directory into a listing the tree builder can nest', async () => {
    const entries = await walkFiles(ROOT);
    expect(entries.some((e) => e.path === PLAN && e.isFile)).toBe(true);
    expect(entries.every((e) => !e.path.includes('\\'))).toBe(true);
  });

  it('answers 404 for an unknown path and 405 for a write', async () => {
    const running = await serveFixtures();
    expect((await authed(`${running.url}nope`, running)).status).toBe(404);
    expect((await authed(running.url, running, { method: 'POST' })).status).toBe(405);
  });

  it('re-reads the host on every request', async () => {
    const running = await serveFixtures();
    const first = (await (await authed(`${running.url}api/state`, running)).json()) as PawSnapshot;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = (await (await authed(`${running.url}api/state`, running)).json()) as PawSnapshot;
    expect(second.host.uptimeSec).toBeGreaterThanOrEqual(first.host.uptimeSec);
  });

  it('falls back to the bootstrap page when the console has not been built', async () => {
    const runtime = nodeRuntime(join(ROOT, 'does-not-exist.html'));
    await expect(runtime.readPage()).resolves.toBe(BOOTSTRAP);
  });

  it('rethrows a page read that failed for any other reason', async () => {
    await expect(nodeRuntime(ROOT).readPage()).rejects.toThrow();
  });

  it('reports a source failure to the operator’s terminal, not to a swallowed promise', async () => {
    const written: string[] = [];
    const real = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string): boolean => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      nodeRuntime(PAGE).warn('listing source failed: EACCES');
    } finally {
      process.stderr.write = real;
    }

    expect(written.join('')).toBe('pawd: listing source failed: EACCES\n');
    await Promise.resolve();
  });

  it('serves the console the shell resolved, not one it guessed', () => {
    expect(consolePage().replace(/\\/g, '/')).toContain('gui/dist/live.html');
  });

  it('fails loud on a module that exports no plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paw-bad-'));
    await writeFile(join(root, 'broken.swarm.mjs'), 'export default { name: 1 };\n', 'utf8');
    daemon = await runDaemon({ root }, nodeRuntime(PAGE));
    await expect(daemon.snapshot('broken.swarm.mjs')).rejects.toThrow(
      'does not export a swarm plan',
    );
  });

  it('refuses to bind a port another daemon already holds', async () => {
    const running = await serveFixtures();
    await expect(
      runDaemon({ root: ROOT, configPath: CONFIG, port: running.port }, nodeRuntime(PAGE)),
    ).rejects.toThrow(/EADDRINUSE/);
  });

  it('reports a second close instead of pretending it succeeded', async () => {
    const running = await runDaemon({ root: ROOT, configPath: CONFIG }, nodeRuntime(PAGE));
    await running.close();
    await expect(running.close()).rejects.toThrow();
  });

  it('builds against the resolved console page', () => {
    expect(typeof nodeRuntime(consolePage()).readPage).toBe('function');
  });
});

describe('the live wire, over a real socket', () => {
  /**
   * Open real `wss` connection to daemon, verify its certificate against the CA
   * it issued. Nothing here faked: real TLS, real `ws`, real upgrade gate.
   *
   * @param {DaemonHandle} running - Daemon.
   * @param {{ protocols?: string[]; origin?: string; host?: string }} [over] - What to send instead of defaults.
   * @returns {Promise<Wire>} Socket, its frames, and its close code.
   */
  const dial = (
    running: DaemonHandle,
    over: { protocols?: string[]; origin?: string; host?: string } = {},
  ): {
    socket: WebSocket;
    frames: LiveEnvelope[];
    opened: Promise<void>;
    ended: Promise<{ code: number; reason: string }>;
    settle: () => Promise<void>;
  } => {
    const socket = new WebSocket(
      `wss://127.0.0.1:${running.port}/live`,
      over.protocols ?? [LIVE_SUBPROTOCOL],
      {
        ca: running.identity.caCert,
        headers: {
          ...(over.origin === undefined ? {} : { origin: over.origin }),
          ...(over.host === undefined ? {} : { host: over.host }),
        },
        ...(over.host === undefined ? {} : { servername: '127.0.0.1' }),
      },
    );
    const frames: LiveEnvelope[] = [];
    socket.on('message', (data: Buffer) => {
      const envelope = parseEnvelope(data.toString());
      if (envelope !== null) {
        frames.push(envelope);
      }
    });
    const opened = new Promise<void>((done, fail) => {
      socket.once('open', () => done());
      socket.once('error', fail);
    });
    const ended = new Promise<{ code: number; reason: string }>((done) => {
      socket.once('close', (code: number, reason: Buffer) =>
        done({ code, reason: reason.toString() }),
      );
    });
    return {
      socket,
      frames,
      opened,
      ended,
      settle: () => new Promise<void>((done) => setTimeout(done, 120)),
    };
  };

  it('upgrades, authenticates, and answers with the whole state', async () => {
    const running = await serveFixtures(PLAN);
    const wire = dial(running);
    await wire.opened;

    expect(wire.socket.protocol).toBe(LIVE_SUBPROTOCOL);
    wire.socket.send(authFrame(running.token));
    await wire.settle();

    expect(wire.frames.map((frame) => frame.topic)).toContain('hello');
    const hello = wire.frames.find((frame) => frame.topic === 'hello');
    expect((hello?.data as PawSnapshot).planName).toBe('demo');
    expect((hello?.data as PawSnapshot).host.pid).toBe(process.pid);
    wire.socket.close();
  }, 30000);

  it('sends a client with the wrong credential nothing at all, and closes 4401', async () => {
    const running = await serveFixtures();
    const wire = dial(running);
    await wire.opened;

    wire.socket.send(authFrame('not-the-token'));
    const { code } = await wire.ended;

    expect(code).toBe(CLOSE_AUTH);
    // Not one frame cross the wire. Any local process can open this socket;
    // only a client that authenticates receives data.
    expect(wire.frames).toEqual([]);
  }, 30000);

  it('refuses a client that did not offer the subprotocol, before upgrading', async () => {
    const running = await serveFixtures();
    const wire = dial(running, { protocols: ['chat'] });

    await expect(wire.opened).rejects.toThrow(/400|Unexpected server response/);
  }, 30000);

  it('refuses a stranger’s Origin at the handshake, where CORS does not reach', async () => {
    const running = await serveFixtures();
    const wire = dial(running, { origin: 'https://evil.example' });

    await expect(wire.opened).rejects.toThrow(/403|Unexpected server response/);
  }, 30000);

  it('refuses a rebinding Host at the handshake too', async () => {
    const running = await serveFixtures();
    const wire = dial(running, { host: 'evil.example' });

    await expect(wire.opened).rejects.toThrow(/400|Unexpected server response/);
  }, 30000);

  it('streams the host slice as a liveness tick', async () => {
    daemon = await runDaemon(
      { root: ROOT, configPath: CONFIG, hostMs: 60 },
      nodeRuntime(PAGE),
    );
    const wire = dial(daemon);
    await wire.opened;
    wire.socket.send(authFrame(daemon.token));
    await wire.settle();

    const ticks = wire.frames.filter((frame) => frame.topic === 'host');
    expect(ticks.length).toBeGreaterThan(0);
    expect(typeof ticks[0].at).toBe('number');
    wire.socket.close();
  }, 30000);

  it('switches plans on the same socket rather than reconnecting', async () => {
    const running = await serveFixtures();
    const wire = dial(running);
    await wire.opened;
    wire.socket.send(authFrame(running.token));
    await wire.settle();

    wire.socket.send(watchFrame(PLAN));
    await wire.settle();

    const hellos = wire.frames.filter((frame) => frame.topic === 'hello');
    expect(hellos).toHaveLength(2);
    expect((hellos[0].data as PawSnapshot).selectedPlan).toBeNull();
    expect((hellos[1].data as PawSnapshot).selectedPlan).toBe(PLAN);
    wire.socket.close();
  }, 30000);

  it('answers a plan the repository does not hold with an error, not a disconnect', async () => {
    const running = await serveFixtures();
    const wire = dial(running);
    await wire.opened;
    wire.socket.send(authFrame(running.token));
    await wire.settle();

    wire.socket.send(watchFrame('../../../etc/passwd'));
    await wire.settle();

    expect(wire.frames.at(-1)?.topic).toBe('error');
    expect(wire.socket.readyState).toBe(WebSocket.OPEN);
    wire.socket.close();
  }, 30000);

  it('closes a client that sends a malformed frame', async () => {
    const running = await serveFixtures();
    const wire = dial(running);
    await wire.opened;
    wire.socket.send(authFrame(running.token));
    await wire.settle();

    wire.socket.send('{"v":1,"m":"eval","c":"process.exit()"}');
    const { code } = await wire.ended;

    expect(code).toBe(CLOSE_MALFORMED);
  }, 30000);

  it('refuses a binary frame rather than growing a second decode path', async () => {
    const running = await serveFixtures();
    const wire = dial(running);
    await wire.opened;
    wire.socket.send(authFrame(running.token));
    await wire.settle();

    wire.socket.send(Buffer.from([0x00, 0x01, 0x02]));
    const { code } = await wire.ended;

    expect(code).toBe(CLOSE_MALFORMED);
  }, 30000);

  it('closes a socket that never authenticates, with a code it can retry on', async () => {
    const running = await serveFixtures();
    const wire = dial(running);
    await wire.opened;

    const { code } = await wire.ended;

    // Not 4401: slow socket not rejected credential, console told 4401 stop
    // retrying for life of page.
    expect(code).toBe(CLOSE_MALFORMED);
    expect(wire.frames).toEqual([]);
  }, 30000);

  it('tells its sessions why when the daemon goes away', async () => {
    const running = await serveFixtures();
    const wire = dial(running);
    await wire.opened;
    wire.socket.send(authFrame(running.token));
    await wire.settle();

    await running.close();
    daemon = null;
    const { code } = await wire.ended;

    // Console told 1001 stop retrying; abrupt drop reconnect forever.
    expect(code).toBe(CLOSE_SHUTDOWN);
  }, 30000);
});

describe('request plumbing', () => {
  it('resolves a request line, defaulting what Node leaves undefined', () => {
    const posted = requestTarget('POST', '/api/tree?root=src', '127.0.0.1');
    expect(posted.method).toBe('POST');
    expect(posted.path).toBe('/api/tree');
    expect(posted.query.get('root')).toBe('src');

    const bare = requestTarget(undefined, undefined, '127.0.0.1');
    expect(bare.method).toBe('GET');
    expect(bare.path).toBe('/');
    expect(bare.query.get('root')).toBeNull();
  });

  it('takes the first of a repeated header rather than merging it', () => {
    // Only the first value of a repeated Host or Origin header is read; a
    // repeated header is not concatenated.
    expect(firstHeader(['127.0.0.1:8971', 'evil.example'])).toBe('127.0.0.1:8971');
    expect(firstHeader('127.0.0.1:8971')).toBe('127.0.0.1:8971');
    expect(firstHeader(undefined)).toBeUndefined();
  });

  it('discloses three fields per process and roots a parentless one at 0', () => {
    expect(toHostProcess({ pid: 4, ppid: 1, name: 'node' })).toEqual({
      pid: 4,
      ppid: 1,
      name: 'node',
    });
    expect(toHostProcess({ pid: 4, name: 'node' })).toEqual({ pid: 4, ppid: 0, name: 'node' });
  });

  it('reads the bound port from a socket address and falls back otherwise', () => {
    expect(boundPort({ port: 8971 }, 0)).toBe(8971);
    expect(boundPort('\\\\.\\pipe\\paw', 8080)).toBe(8080);
    expect(boundPort(null, 8080)).toBe(8080);
  });

  it.each([
    ['an Error', (): never => {
      throw new Error('handler exploded');
    }, 'handler exploded'],
    ['a thrown value', (): never => {
      throw 'socket closed';
    }, 'socket closed'],
  ])('answers 500 when a request handler fails with %s, telling the client nothing', async (
    _label,
    fail,
    detail,
  ) => {
    const identity = await nodeRuntime(PAGE).identity();
    const server = await nodeRuntime(PAGE).listen(
      async () => fail(),
      REFUSING_HOOKS,
      0,
      '127.0.0.1',
      identity,
    );
    const res = await call(`https://127.0.0.1:${server.port}/`, identity.caCert);

    expect(res.status).toBe(500);
    // Operator get detail on stderr; caller get nothing to work with. Error
    // body is a disclosure channel.
    expect(res.text()).toBe('internal error');
    expect(res.text()).not.toContain(detail);
    await server.close();
  });
});

describe('the daemon’s TLS', () => {
  it('serves a certificate that verifies against the CA it issued, with no exception made', async () => {
    const running = await serveFixtures();
    // `call` runs with rejectUnauthorized on: reaching 200 here means the
    // certificate chain validated; otherwise nothing below executes.
    const page = await call(running.url, running.identity.caCert);
    expect(page.status).toBe(200);
    expect(running.identity.meta.leafFingerprint).toMatch(/^SHA256(:[0-9A-F]{2}){32}$/);
  });

  it('is refused by a client that does not know that CA — no daemon is universally trusted', async () => {
    const running = await serveFixtures();
    // CA from another install must not vouch for this one. This the check that
    // fail first if leaf ever self-signed or CA ever shipped.
    const stranger = await issueCa('someone', 'ELSEWHERE', new Date());
    await expect(call(running.url, stranger.cert)).rejects.toThrow(
      /self-signed|unable to verify|UNABLE/i,
    );
  });

  it('answers on the IPv6 loopback too, so https://localhost reaches it', async () => {
    const running = await serveFixtures();
    const res = await call(`https://localhost:${running.port}/`, running.identity.caCert);
    expect(res.status).toBe(200);
  });

  it('survives an IPv6 loopback it cannot bind, and says so rather than going quiet', async () => {
    const running = await serveFixtures();
    const squatter = createPlainServer();
    await new Promise<void>((done) => squatter.listen(0, LOOPBACK_V6, done));
    const taken = (squatter.address() as { port: number }).port;

    const server = createConsoleServer(
      running.identity,
      async () => ({ status: 200, headers: {}, body: '' }),
      '127.0.0.1',
    );
    await expect(bindLoopbackV6(server, taken)).resolves.toBe(false);

    await new Promise<void>((done) => squatter.close(() => done()));
  });

  it('keeps serving when a socket errors after it is already bound', async () => {
    const running = await serveFixtures();
    const server = createConsoleServer(
      running.identity,
      async () => ({ status: 200, headers: {}, body: '' }),
      '127.0.0.1',
    );
    await bindServer(server, 0, '127.0.0.1', false);

    // With no listener, Node throw this and pawd die. Daemon must survive.
    expect(() => server.emit('error', new Error('connection reset'))).not.toThrow();
    await closeServer(server);
  });

  it('reports a bind that failed with something that is not an Error', async () => {
    // Node emit Errors, but stack that reject with string would otherwise print
    // "[object Object]" and leave operator with nothing to search for.
    const throwing = {
      once: (event: string, cb: (err: unknown) => void) => {
        if (event === 'error') {
          setImmediate(() => cb('socket vanished'));
        }
      },
      listen: () => undefined,
      removeListener: () => undefined,
    } as unknown as Parameters<typeof bindLoopbackV6>[0];

    await expect(bindLoopbackV6(throwing, 1)).resolves.toBe(false);
  });

  it('reuses the identity it issued rather than minting one per boot', async () => {
    const first = await serveFixtures();
    const fingerprint = first.identity.meta.caFingerprint;
    await first.close();

    const second = await serveFixtures();
    // Reissuing per boot would ask the operator to approve a new CA every time.
    expect(second.identity.action).toBe('reuse');
    expect(second.identity.meta.caFingerprint).toBe(fingerprint);
    expect(second.identity.meta.leafFingerprint).toBe(first.identity.meta.leafFingerprint);
  });
});

describe('the reporting daemon’s model port', () => {
  it('refuses to spend tokens rather than answering with an empty completion', async () => {
    await expect(REFUSING_MODEL.complete({ model: 'ds-flash', prompt: 'hi' })).rejects.toThrow(
      'pawd reports state and does not dispatch members',
    );
  });
});
