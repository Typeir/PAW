/**
 * Daemon Service Tests
 *
 * @fileoverview The daemon's whole sequence against a fake runtime: what it
 * discovers, what it binds, what it serves for a selected plan, what it re-reads
 * on a poll, what it refuses, and what it tears down on close. No socket is
 * opened here and no file is touched — that is the point of taking the runtime
 * as a seam. The plan-selection tests are the heart of it: one daemon serves a
 * repository of plans, and the console picks between them per request.
 *
 * @module @paw/daemon/test/serve
 */

import {
  AUTH_TIMEOUT_MS,
  CLOSE_AUTH,
  CLOSE_MALFORMED,
  CLOSE_SHUTDOWN,
  LIVE_SUBPROTOCOL,
  MAX_PREAUTH_SESSIONS,
  authFrame,
  parseEnvelope,
  watchFrame,
  type DispatchEvent,
  type HostInfo,
  type HostProcess,
  type LogEntry,
  type PawSnapshot,
  type RunProgress,
  type SwarmPlan,
} from '@paw/core';
import { describe, expect, it, vi } from 'vitest';
import { CA_DAYS, LEAF_DAYS, META_VERSION, addDays } from '../src/domain/identity.js';
import type { ServerIdentity } from '../src/infrastructure/identityStore.js';
import { UnknownPlanError } from '../src/domain/plans.js';
import type { HttpRequest, HttpResponse } from '../src/domain/router.js';
import { runDaemon } from '../src/application/runDaemon.js';
import {
  LOOPBACK,
  modelCount,
  toPlan,
  underRoot,
  type DaemonRuntime,
  type ServerHandle,
  type SocketHooks,
  type TlsMaterial,
} from '../src/application/daemonContracts.js';
import type { FileEntry } from '../src/domain/tree.js';

const TOKEN = 'test-token-value-0123456789abcdef';

const ISSUED_AT = new Date('2026-08-05T15:40:02.000Z');

/**
 * A stand-in for the machine's TLS identity. The daemon must present it and
 * never invent one, so the fake is recognisable on sight.
 */
const IDENTITY: ServerIdentity = {
  cert: 'LEAF-CERT',
  key: 'LEAF-KEY',
  caCert: 'CA-CERT',
  caCertPath: '/paw-home/identity/ca.crt',
  action: 'reuse',
  meta: {
    version: META_VERSION,
    caFingerprint: 'SHA256:CA',
    caNotAfter: addDays(ISSUED_AT, CA_DAYS).toISOString(),
    leafFingerprint: 'SHA256:LEAF',
    leafNotAfter: addDays(ISSUED_AT, LEAF_DAYS).toISOString(),
    trusted: false,
  },
};

const HOST: HostInfo = {
  pid: 42,
  ppid: 7,
  uptimeSec: 90,
  rssBytes: 5 * 1024 * 1024,
  hostname: 'box',
  platform: 'linux',
  release: '6.1',
  cpus: 8,
  node: 'v22.0.0',
  cwd: '/paw',
};

/**
 * Build a plan whose briefs name it, so a snapshot proves which plan was loaded.
 *
 * @param {string} name - The plan's name.
 * @returns {SwarmPlan<{ files: string[] }>} The plan.
 */
const planNamed = (name: string): SwarmPlan<{ files: string[] }> => ({
  name,
  role: 'edit.apply',
  args: { files: ['a.mdx', 'b.mdx'] },
  members: (args) => args.files.length,
  brief: (args, member, total) => `${name} ${member + 1}/${total}: ${args.files[member]}`,
  key: (args, member) => args.files[member],
});

const CONFIG = JSON.stringify({
  root: '.paw',
  gatesDir: '.paw/gates',
  connector: 'copilot-hooks',
  models: {
    'ds-flash': {
      contextTokens: 128000,
      maxOutputTokens: 16384,
      tools: true,
      structuredOutput: true,
      reasoning: true,
      vision: false,
      costClass: 'cheap',
    },
  },
  roles: {
    'edit.apply': 'ds-flash',
    'review.graze': 'ds-flash',
    'review.judge': 'ds-flash',
  },
});

const LISTING: FileEntry[] = [
  { path: '.paw', isFile: false },
  { path: '.paw/config.json', isFile: true },
  { path: 'plans', isFile: false },
  { path: 'plans/edit.swarm.mjs', isFile: true },
  { path: 'plans/lore.swarm.mjs', isFile: true },
  { path: 'src', isFile: false },
  { path: 'src/main.ts', isFile: true },
];

/**
 * What a fake run recorded, so a test can drive the daemon after it started.
 *
 * @interface Rig
 * @property {DaemonRuntime} runtime - The fake runtime.
 * @property {() => Handler | null} handler - The bound handler.
 * @property {() => void} tick - Fire the scheduled source poll once.
 * @property {() => void} tickHost - Fire the host/liveness ticker once.
 * @property {{ closed: boolean; cancelled: boolean; tls: TlsMaterial | null }} state - Teardown flags and the certificate the daemon bound with.
 * @property {string[]} imported - Every module path the daemon imported, in order.
 * @property {string[]} warnings - Everything the daemon reported without dying of it.
 */
interface Rig {
  readonly runtime: DaemonRuntime;
  handler(): Handler | null;
  hooks(): SocketHooks | null;
  tick(): void;
  tickHost(): void;
  advance(ms: number): void;
  readonly state: { closed: boolean; cancelled: boolean; tls: TlsMaterial | null };
  readonly imported: string[];
  readonly warnings: string[];
}

/**
 * The request handler the daemon binds.
 */
type Handler = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * Issue a request the way a browser on the console's own origin would.
 *
 * @param {string} path - The request path.
 * @param {URLSearchParams} [query] - The query string.
 * @param {Partial<HttpRequest>} [over] - Overrides, e.g. a different method or headers.
 * @returns {HttpRequest} The request.
 */
const asConsole = (
  path: string,
  query?: URLSearchParams,
  over: Partial<HttpRequest> = {},
): HttpRequest => ({
  method: 'GET',
  path,
  query,
  headers: { host: '127.0.0.1:8971', authorization: `Bearer ${TOKEN}`, ...over.headers },
  ...(over.method === undefined ? {} : { method: over.method }),
});

/**
 * Build a fake runtime over a two-plan repository whose process table changes
 * between polls.
 *
 * @param {Partial<DaemonRuntime>} [over] - Runtime overrides.
 * @returns {Rig} The rig.
 */
function makeRig(over: Partial<DaemonRuntime> = {}): Rig {
  const tables: HostProcess[][] = [
    [{ pid: 42, ppid: 7, name: 'node' }],
    [
      { pid: 42, ppid: 7, name: 'node' },
      { pid: 43, ppid: 42, name: 'worker' },
    ],
  ];
  let call = 0;
  let clockMs = 0;
  let handler: Handler | null = null;
  let hooks: SocketHooks | null = null;
  // The daemon schedules the host ticker first and the source poll second, so
  // the two are driven independently here rather than fired as one.
  const scheduled: Array<() => void> = [];
  const state = { closed: false, cancelled: false, tls: null as TlsMaterial | null };
  const imported: string[] = [];
  const warnings: string[] = [];

  const runtime: DaemonRuntime = {
    readFile: async (path: string) =>
      path.endsWith('.json') ? CONFIG : `source of ${path}`,
    importModule: async (path: string) => {
      imported.push(path);
      return { default: planNamed(path.includes('lore') ? 'lore' : 'edit') };
    },
    modifiedAt: async () => 1000,
    listProcesses: async () => tables[Math.min(call++, tables.length - 1)],
    listFiles: async () => LISTING,
    readHost: () => HOST,
    now: () => '2026-08-05T15:40:02.000Z',
    clock: () => clockMs,
    warn: (message: string) => {
      warnings.push(message);
    },
    randomToken: () => TOKEN,
    identity: async () => IDENTITY,
    readPage: async () => '<html>console</html>',
    listen: async (h, socketHooks, _port, _host, tls): Promise<ServerHandle> => {
      handler = h;
      hooks = socketHooks;
      state.tls = tls;
      return {
        port: 8971,
        close: async () => {
          state.closed = true;
        },
      };
    },
    schedule: (fn) => {
      scheduled.push(fn);
      return () => {
        state.cancelled = true;
      };
    },
    ...over,
  };

  return {
    runtime,
    handler: () => handler,
    hooks: () => hooks,
    tick: () => scheduled[1]?.(),
    tickHost: () => scheduled[0]?.(),
    advance: (ms: number) => {
      clockMs += ms;
    },
    state,
    imported,
    warnings,
  };
}

/**
 * Let every queued microtask settle, so a source the daemon fired off without
 * awaiting has finished before the assertions read what it published.
 *
 * @returns {Promise<void>} Resolves once the queue is drained.
 */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

/**
 * Read a routed JSON body.
 *
 * @param {HttpResponse | undefined} res - The response.
 * @returns {PawSnapshot} The parsed snapshot.
 */
const parse = (res: HttpResponse | undefined): PawSnapshot =>
  JSON.parse(res?.body ?? '{}') as PawSnapshot;

describe('toPlan', () => {
  it('accepts a default export and a named plan export', () => {
    expect(toPlan({ default: planNamed('x') }, 'p.mjs').name).toBe('x');
    expect(toPlan({ plan: planNamed('x') }, 'p.mjs').name).toBe('x');
  });

  it('fails loud on a module that exports no plan', () => {
    expect(() => toPlan({}, 'p.mjs')).toThrow('"p.mjs" does not export a swarm plan');
    expect(() => toPlan({ default: { name: 'x' } }, 'p.mjs')).toThrow('does not export a swarm plan');
    expect(() => toPlan(null, 'p.mjs')).toThrow('does not export a swarm plan');
  });
});

describe('modelCount', () => {
  it('counts declared models and tolerates a config that declares none', () => {
    expect(modelCount({ models: { a: {}, b: {} } })).toBe(2);
    expect(modelCount({})).toBe(0);
    expect(modelCount({ models: null })).toBe(0);
  });
});

describe('underRoot', () => {
  it('opens a repo-relative path under the served root', () => {
    expect(underRoot('.', 'plans/a.swarm.mjs')).toBe('./plans/a.swarm.mjs');
    expect(underRoot('../other/', 'a.md')).toBe('../other/a.md');
    expect(underRoot('C:\\repo', 'a.md')).toBe('C:/repo/a.md');
    expect(underRoot('', 'a.md')).toBe('./a.md');
  });
});

describe('runDaemon', () => {
  it('serves a repository: binds loopback and reports what it found', async () => {
    const rig = makeRig();
    const listen = vi.spyOn(rig.runtime, 'listen');
    const daemon = await runDaemon({}, rig.runtime);

    expect(daemon.url).toBe('https://127.0.0.1:8971/');
    expect(daemon.root).toBe('.');
    expect(daemon.plans).toEqual(['plans/edit.swarm.mjs', 'plans/lore.swarm.mjs']);
    expect(daemon.openedOn).toBeNull();
    expect(listen).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ check: expect.any(Function), accept: expect.any(Function) }),
      0,
      LOOPBACK,
      { cert: IDENTITY.cert, key: IDENTITY.key },
    );
  });

  it('binds with the machine’s identity and never invents one of its own', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);

    // A daemon that generated a certificate inline would serve a new one every
    // boot, and the operator's trust decision would never stick.
    expect(rig.state.tls).toEqual({ cert: 'LEAF-CERT', key: 'LEAF-KEY' });
    expect(daemon.identity).toBe(IDENTITY);
    expect(daemon.url.startsWith('https://')).toBe(true);
  });

  it('refuses to serve at all when the identity cannot be loaded', async () => {
    const rig = makeRig({
      identity: async () => {
        throw new Error('refusing to serve: ca.key landed as mode 644');
      },
    });
    // Falling back to plaintext here would be the one weasel that undoes the
    // whole design, so the failure must reach the operator untouched.
    await expect(runDaemon({}, rig.runtime)).rejects.toThrow('landed as mode 644');
  });

  it('imports no plan until one is selected', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    const snapshot = await daemon.snapshot();

    expect(rig.imported).toEqual([]);
    expect(snapshot.selectedPlan).toBeNull();
    expect(snapshot.planName).toBe('');
    expect(snapshot.memberTotal).toBe(0);
    expect(snapshot.briefs).toEqual([]);
    expect(snapshot.slugs).toEqual([]);
    expect(snapshot.planFindings).toEqual([]);
    expect(snapshot.plans).toHaveLength(2);
  });

  it('opens on the plan it was given', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({ planPath: 'plans/lore.swarm.mjs' }, rig.runtime);
    expect(daemon.openedOn).toBe('plans/lore.swarm.mjs');
    expect((await daemon.snapshot()).planName).toBe('lore');
  });

  it('refuses to open on a plan the repository does not hold', async () => {
    const rig = makeRig();
    await expect(runDaemon({ planPath: '../evil.swarm.mjs' }, rig.runtime)).rejects.toThrow(
      UnknownPlanError,
    );
  });

  it('serves whichever plan the request selects, without a restart', async () => {
    const rig = makeRig();
    await runDaemon({}, rig.runtime);
    const handler = rig.handler();

    const lore = parse(
      await handler?.(asConsole('/api/state', new URLSearchParams('plan=plans/lore.swarm.mjs'))),
    );
    expect(lore.planName).toBe('lore');
    expect(lore.selectedPlan).toBe('plans/lore.swarm.mjs');
    expect(lore.briefs).toEqual(['lore 1/2: a.mdx', 'lore 2/2: b.mdx']);

    const edit = parse(
      await handler?.(asConsole('/api/state', new URLSearchParams('plan=plans/edit.swarm.mjs'))),
    );
    expect(edit.planName).toBe('edit');
    expect(edit.plans).toEqual(['plans/edit.swarm.mjs', 'plans/lore.swarm.mjs']);
  });

  it('answers 404 for a plan outside the repository rather than importing it', async () => {
    const rig = makeRig();
    await runDaemon({}, rig.runtime);
    const res = await rig
      .handler()
      ?.(asConsole('/api/state', new URLSearchParams('plan=../evil.mjs')));
    expect(res?.status).toBe(404);
    expect(res?.body).toContain('no such plan in this repository');
    expect(rig.imported).toEqual([]);
  });

  it('imports a plan once and reuses it until the file changes', async () => {
    let mtime = 1000;
    const rig = makeRig({ modifiedAt: async () => mtime });
    const daemon = await runDaemon({}, rig.runtime);

    await daemon.snapshot('plans/lore.swarm.mjs');
    await daemon.snapshot('plans/lore.swarm.mjs');
    expect(rig.imported).toHaveLength(1);

    mtime = 2000;
    await daemon.snapshot('plans/lore.swarm.mjs');
    expect(rig.imported).toHaveLength(2);
  });

  it('finds the config by convention and reports where it came from', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    const snapshot = await daemon.snapshot();
    expect(snapshot.configPath).toBe('.paw/config.json');
    expect(snapshot.doctor.ok).toBe(true);
    expect(snapshot.chrome.keys).toBe(1);
  });

  it('takes an explicit config path', async () => {
    const rig = makeRig();
    const read = vi.spyOn(rig.runtime, 'readFile');
    const daemon = await runDaemon({ configPath: 'custom/paw.json' }, rig.runtime);
    expect(read).toHaveBeenCalledWith('./custom/paw.json');
    expect((await daemon.snapshot()).configPath).toBe('custom/paw.json');
  });

  it('serves a repository with no config, and the doctor says what is missing', async () => {
    const rig = makeRig({ listFiles: async () => [{ path: 'README.md', isFile: true }] });
    const daemon = await runDaemon({}, rig.runtime);
    const snapshot = await daemon.snapshot();
    expect(snapshot.configPath).toBe('');
    expect(snapshot.plans).toEqual([]);
    expect(snapshot.doctor.ok).toBe(false);
    expect(snapshot.doctor.config.length).toBeGreaterThan(0);
  });

  it('takes the port and the root it was asked for', async () => {
    const rig = makeRig();
    const listen = vi.spyOn(rig.runtime, 'listen');
    const list = vi.spyOn(rig.runtime, 'listFiles');
    const daemon = await runDaemon({ port: 9090, root: 'packages' }, rig.runtime);
    expect(listen).toHaveBeenCalledWith(
      expect.any(Function),
      expect.anything(),
      9090,
      LOOPBACK,
      { cert: IDENTITY.cert, key: IDENTITY.key },
    );
    expect(list).toHaveBeenCalledWith('packages');
    expect(daemon.root).toBe('packages');
  });

  it('resolves a plan whose member count is a plain number', async () => {
    const rig = makeRig({
      importModule: async () => ({ default: { ...planNamed('fixed'), members: 5 } }),
    });
    const daemon = await runDaemon({ planPath: 'plans/edit.swarm.mjs' }, rig.runtime);
    expect((await daemon.snapshot()).memberTotal).toBe(5);
  });

  it('serves the page at the root and live host state at /api/state', async () => {
    const rig = makeRig();
    await runDaemon({}, rig.runtime);
    const handler = rig.handler();

    const page = await handler?.(asConsole('/'));
    expect(page?.status).toBe(200);
    expect(page?.body).toBe('<html>console</html>');

    const snapshot = parse(await handler?.(asConsole('/api/state')));
    expect(snapshot.host).toEqual(HOST);
    expect(snapshot.daemon.socket).toBe('127.0.0.1:8971');
    expect(snapshot.run.id).toBe('15-40-02');
  });

  it('serves the repository file tree, whole and narrowed', async () => {
    const rig = makeRig();
    await runDaemon({}, rig.runtime);
    const handler = rig.handler();

    const whole = JSON.parse((await handler?.(asConsole('/api/tree')))?.body ?? '[]');
    expect(whole.map((n: { name: string }) => n.name)).toEqual(['.paw', 'plans', 'src']);

    const narrowed = await handler?.(asConsole('/api/tree', new URLSearchParams('root=src')));
    expect(JSON.parse(narrowed?.body ?? '[]')).toEqual([
      { name: 'main.ts', path: 'src/main.ts', isFile: true, children: [] },
    ]);
  });

  it('serves the declared models and role bindings for the config editor', async () => {
    const rig = makeRig();
    await runDaemon({}, rig.runtime);
    const res = await rig.handler()?.(asConsole('/api/config'));
    expect(JSON.parse(res?.body ?? '{}')).toEqual({
      models: ['ds-flash'],
      roles: { 'edit.apply': 'ds-flash', 'review.graze': 'ds-flash', 'review.judge': 'ds-flash' },
    });
  });

  it('serves empty models and bindings for an unconfigured repo', async () => {
    const rig = makeRig({
      listFiles: async () => LISTING.filter((entry) => entry.path !== '.paw/config.json'),
    });
    await runDaemon({}, rig.runtime);
    const res = await rig.handler()?.(asConsole('/api/config'));
    expect(JSON.parse(res?.body ?? '{}')).toEqual({ models: [], roles: {} });
  });

  it('re-reads the process table, tree, and plan list on every poll', async () => {
    let listing = LISTING;
    const rig = makeRig({ listFiles: async () => listing });
    const daemon = await runDaemon({ pollMs: 10 }, rig.runtime);
    expect((await daemon.snapshot()).processes).toHaveLength(1);
    expect((await daemon.snapshot()).plans).toHaveLength(2);

    listing = [...LISTING, { path: 'plans/new.swarm.mjs', isFile: true }];
    rig.tick();
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = await daemon.snapshot();
    expect(snapshot.processes).toHaveLength(2);
    expect(snapshot.plans).toContain('plans/new.swarm.mjs');
  });

  it('publishes the host on every tick, because silence is the liveness signal', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    const heard: unknown[] = [];
    daemon.bus.subscribe('host', (host) => heard.push(host));

    rig.tickHost();
    rig.tickHost();

    // Unchanged host facts still publish: a client that hears nothing must be
    // able to conclude the daemon is gone rather than merely idle.
    expect(heard).toEqual([HOST, HOST]);
  });

  it('publishes the process table only when it actually changed', async () => {
    const table = [{ pid: 42, ppid: 7, name: 'node' }];
    let current = table;
    const rig = makeRig({ listProcesses: async () => current });
    const daemon = await runDaemon({}, rig.runtime);
    const heard: unknown[] = [];
    daemon.bus.subscribe('processes', (next) => heard.push(next));

    rig.tick();
    await settle();
    expect(heard).toHaveLength(0);

    current = [...table, { pid: 43, ppid: 42, name: 'worker' }];
    rig.tick();
    await settle();
    expect(heard).toHaveLength(1);

    // A fresh array of identical rows is not news.
    current = [...current];
    rig.tick();
    await settle();
    expect(heard).toHaveLength(1);
  });

  it('publishes the plan list and the tree independently', async () => {
    let listing = LISTING;
    const rig = makeRig({ listFiles: async () => listing });
    const daemon = await runDaemon({}, rig.runtime);
    const plans: unknown[] = [];
    const trees: unknown[] = [];
    daemon.bus.subscribe('plans', (next) => plans.push(next));
    daemon.bus.subscribe('tree', (next) => trees.push(next));

    // A new source file moves the tree and leaves the picker alone.
    listing = [...LISTING, { path: 'src/added.ts', isFile: true }];
    rig.tick();
    await settle();
    expect(plans).toHaveLength(0);
    expect(trees).toHaveLength(1);

    listing = [...listing, { path: 'plans/new.swarm.mjs', isFile: true }];
    rig.tick();
    await settle();
    expect(plans).toHaveLength(1);
    expect(trees).toHaveLength(2);
  });

  it('re-reads the config and re-runs the doctor when the file changes', async () => {
    let mtime = 1000;
    let json = CONFIG;
    const rig = makeRig({
      modifiedAt: async (path: string) => (path.endsWith('.json') ? mtime : 1000),
      readFile: async (path: string) => (path.endsWith('.json') ? json : `source of ${path}`),
    });
    const daemon = await runDaemon({}, rig.runtime);
    const doctors: unknown[] = [];
    daemon.bus.subscribe('doctor', (next) => doctors.push(next));

    rig.tick();
    await settle();
    expect(doctors).toHaveLength(0);

    json = JSON.stringify({ ...JSON.parse(CONFIG), roles: {} });
    mtime = 2000;
    rig.tick();
    await settle();

    expect(doctors).toHaveLength(1);
    // The served snapshot reflects the edit rather than the config as it was at
    // boot — a daemon that reports yesterday's doctor is worse than none.
    expect((await daemon.snapshot()).doctor.ok).toBe(false);
  });

  it('does not go looking for a config the repository does not have', async () => {
    const rig = makeRig({
      listFiles: async () => LISTING.filter((entry) => !entry.path.endsWith('.json')),
      modifiedAt: async (path: string) => {
        if (path.endsWith('.json')) {
          throw new Error('ENOENT: no config here');
        }
        return 1000;
      },
    });
    const daemon = await runDaemon({}, rig.runtime);

    rig.tick();
    await settle();

    expect(rig.warnings).toEqual([]);
    expect((await daemon.snapshot()).configPath).toBe('');
  });

  it('publishes the opened plan when its file changes, and not when it has not', async () => {
    let mtime = 1000;
    const rig = makeRig({ modifiedAt: async () => mtime });
    const daemon = await runDaemon({ planPath: 'plans/lore.swarm.mjs' }, rig.runtime);
    const details: unknown[] = [];
    daemon.bus.subscribe('planDetail', (next) => details.push(next));

    rig.tick();
    await settle();
    expect(details).toHaveLength(1);

    rig.tick();
    await settle();
    expect(details).toHaveLength(1);

    mtime = 2000;
    rig.tick();
    await settle();
    expect(details).toHaveLength(2);
  });

  it('keeps every watched plan fresh, not only the one it opened on', async () => {
    let mtime = 1000;
    const rig = makeRig({ modifiedAt: async () => mtime });
    const daemon = await runDaemon({ planPath: 'plans/lore.swarm.mjs' }, rig.runtime);
    const details: string[] = [];
    daemon.bus.subscribe('planDetail', (slice) => details.push(slice.selectedPlan ?? '(none)'));

    // A second console picks the other plan. Re-rendering only `openedOn` would
    // leave it showing briefs that never update again — silently stale, which is
    // worse than visibly broken, because nothing says so.
    const socket = rig.hooks()?.accept({
      send: () => undefined,
      close: () => undefined,
      bufferedAmount: () => 0,
    });
    await socket?.message(authFrame(TOKEN));
    await socket?.message(watchFrame('plans/edit.swarm.mjs'));

    mtime = 2000;
    rig.tick();
    await settle();

    expect(details).toContain('plans/lore.swarm.mjs');
    expect(details).toContain('plans/edit.swarm.mjs');
  });

  it('forgets a plan once nobody is watching it', async () => {
    let mtime = 1000;
    const rig = makeRig({ modifiedAt: async () => mtime });
    const daemon = await runDaemon({}, rig.runtime);
    const details: string[] = [];
    daemon.bus.subscribe('planDetail', (slice) => details.push(slice.selectedPlan ?? '(none)'));

    const socket = rig.hooks()?.accept({
      send: () => undefined,
      close: () => undefined,
      bufferedAmount: () => 0,
    });
    await socket?.message(authFrame(TOKEN));
    await socket?.message(watchFrame('plans/edit.swarm.mjs'));
    rig.tick();
    await settle();
    expect(details).toEqual(['plans/edit.swarm.mjs']);

    // The console goes away. Nothing should be rendered for its plan again, and
    // the per-plan map must not keep an entry for it on a daemon that runs for
    // days while an operator clicks through every plan in the repository.
    await socket?.closed();
    mtime = 2000;
    rig.tick();
    await settle();

    expect(details).toEqual(['plans/edit.swarm.mjs']);
  });

  it('keeps rendering the other plans when one of them stops parsing', async () => {
    let mtime = 1000;
    let broken = false;
    const rig = makeRig({
      modifiedAt: async () => mtime,
      importModule: async (path: string) => {
        if (broken && path.includes('lore')) {
          throw new Error('SyntaxError: unexpected token');
        }
        return { default: planNamed(path.includes('lore') ? 'lore' : 'edit') };
      },
    });
    const daemon = await runDaemon({ planPath: 'plans/lore.swarm.mjs' }, rig.runtime);
    const details: string[] = [];
    daemon.bus.subscribe('planDetail', (slice) => details.push(slice.selectedPlan ?? '(none)'));

    const socket = rig.hooks()?.accept({
      send: () => undefined,
      close: () => undefined,
      bufferedAmount: () => 0,
    });
    await socket?.message(authFrame(TOKEN));
    await socket?.message(watchFrame('plans/edit.swarm.mjs'));

    // The operator is mid-edit on the plan the daemon opened on. A second
    // console is watching a different, perfectly healthy plan — and must keep
    // receiving updates for it rather than being frozen by someone else's
    // half-written file.
    broken = true;
    mtime = 2000;
    rig.tick();
    await settle();

    expect(details).toContain('plans/edit.swarm.mjs');
    expect(rig.warnings.some((line) => line.includes('plans/lore.swarm.mjs'))).toBe(true);
  });

  it('still reads the plans when the listing itself failed', async () => {
    let mtime = 1000;
    let listingFails = false;
    const rig = makeRig({
      modifiedAt: async () => mtime,
      listFiles: async () => {
        if (listingFails) {
          throw new Error('EACCES: permission denied');
        }
        return LISTING;
      },
    });
    const daemon = await runDaemon({ planPath: 'plans/lore.swarm.mjs' }, rig.runtime);
    const details: unknown[] = [];
    daemon.bus.subscribe('planDetail', (slice) => details.push(slice));

    // One unreadable directory must not freeze every console's plan updates for
    // as long as it stays unreadable — the last good listing is still usable.
    listingFails = true;
    mtime = 2000;
    rig.tick();
    await settle();

    expect(details).toHaveLength(1);
    expect(rig.warnings.some((line) => line.includes('EACCES'))).toBe(true);
  });

  it('skips a watched plan the repository no longer holds', async () => {
    let listing = LISTING;
    const rig = makeRig({ listFiles: async () => listing });
    const daemon = await runDaemon({ planPath: 'plans/lore.swarm.mjs' }, rig.runtime);
    const details: unknown[] = [];
    daemon.bus.subscribe('planDetail', (slice) => details.push(slice));

    rig.tick();
    await settle();
    expect(details).toHaveLength(1);

    // The operator deleted the plan the daemon opened on. Importing it anyway
    // would throw on every poll for the life of the daemon, and the reader must
    // judge against the listing this same tick produced rather than last tick's.
    listing = LISTING.filter((entry) => !entry.path.includes('lore'));
    rig.tick();
    await settle();

    expect(details).toHaveLength(1);
    expect(rig.warnings).toEqual([]);
  });

  it('says nothing about a plan when none was opened on', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    const details: unknown[] = [];
    daemon.bus.subscribe('planDetail', (next) => details.push(next));

    rig.tick();
    await settle();

    expect(details).toHaveLength(0);
    expect(rig.imported).toEqual([]);
  });

  it('renders a plan’s briefs once per version of its file, not once per request', async () => {
    const plan = planNamed('lore');
    const brief = vi.spyOn(plan, 'brief');
    const rig = makeRig({ importModule: async () => ({ default: plan }) });
    const daemon = await runDaemon({}, rig.runtime);

    await daemon.snapshot('plans/lore.swarm.mjs');
    expect(brief).toHaveBeenCalled();

    brief.mockClear();
    await daemon.snapshot('plans/lore.swarm.mjs');
    await daemon.snapshot('plans/lore.swarm.mjs');

    // The console polls; the plan does not change. Re-rendering every brief on
    // every read is the cost this cache exists to remove.
    expect(brief).not.toHaveBeenCalled();
  });

  it('reports a source that threw and keeps serving', async () => {
    const rig = makeRig({
      listProcesses: async () => {
        throw new Error('ps-list exploded');
      },
    });
    const daemon = await runDaemon({}, rig.runtime).catch(() => null);
    expect(daemon).toBeNull();

    // The boot read fails loudly. A later poll failing must not: the daemon is
    // already serving, and one bad read is not a reason to take it down.
    let fail = false;
    const survivor = makeRig({
      listProcesses: async () => {
        if (fail) {
          throw new Error('ps-list exploded');
        }
        return [{ pid: 42, ppid: 7, name: 'node' }];
      },
    });
    const running = await runDaemon({}, survivor.runtime);
    fail = true;
    survivor.tick();
    await settle();

    expect(survivor.warnings).toContain('process source failed: ps-list exploded');
    expect((await running.snapshot()).host).toEqual(HOST);
  });

  it('publishes what it reports, because a console cannot read stderr', async () => {
    let fail = false;
    const rig = makeRig({
      listProcesses: async () => {
        if (fail) {
          throw new Error('ps-list exploded');
        }
        return [{ pid: 42, ppid: 7, name: 'node' }];
      },
    });
    const daemon = await runDaemon({}, rig.runtime);
    const lines: LogEntry[][] = [];
    daemon.bus.subscribe('log', (batch) => lines.push([...batch]));

    fail = true;
    rig.tick();
    await settle();

    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toEqual({
      at: '2026-08-05T15:40:02.000Z',
      level: 'error',
      message: 'process source failed: ps-list exploded',
    });
    // The terminal still gets it too — the operator watching the process should
    // not have to open a browser to see that a source is failing.
    expect(rig.warnings).toContain('process source failed: ps-list exploded');
  });

  it('does not publish a broken listener’s failure back through the bus', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    let logs = 0;
    daemon.bus.subscribe('log', () => {
      logs += 1;
    });
    daemon.bus.subscribe('host', () => {
      throw new Error('socket already closed');
    });

    rig.tickHost();

    // Publishing a listener failure onto the same bus is how one broken session
    // becomes a loop: the log frame fans out, breaks again, and logs again.
    expect(logs).toBe(0);
    expect(rig.warnings.some((line) => line.includes('listener failed'))).toBe(true);
  });

  it('reports a listener that threw without silencing the rest of the fan-out', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    const heard: unknown[] = [];
    daemon.bus.subscribe('host', () => {
      throw new Error('socket already closed');
    });
    daemon.bus.subscribe('host', (host) => heard.push(host));

    rig.tickHost();

    expect(heard).toEqual([HOST]);
    expect(rig.warnings).toContain('a "host" listener failed: socket already closed');
  });

  it('reports a thrown value that is not an Error', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    daemon.bus.subscribe('host', () => {
      throw 'the socket vanished';
    });

    rig.tickHost();

    expect(rig.warnings).toContain('a "host" listener failed: the socket vanished');
  });

  it('lets the console’s own page open a live socket and refuses a stranger', async () => {
    const rig = makeRig();
    await runDaemon({}, rig.runtime);
    const hooks = rig.hooks();

    expect(
      hooks?.check({
        host: '127.0.0.1:8971',
        origin: 'https://127.0.0.1:8971',
        protocols: [LIVE_SUBPROTOCOL],
      }),
    ).toBeNull();
    expect(
      hooks?.check({
        host: '127.0.0.1:8971',
        origin: 'https://evil.example',
        protocols: [LIVE_SUBPROTOCOL],
      })?.status,
    ).toBe(403);
    // The gate is judged against the port that was actually bound, not the 0 the
    // daemon asked for — otherwise every upgrade fails on an ephemeral port.
    expect(hooks?.check({ host: '127.0.0.1:0', origin: undefined, protocols: [] })?.status).toBe(
      400,
    );
  });

  it('opens a session on the plan the daemon opened on, and feeds it the bus', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({ planPath: 'plans/lore.swarm.mjs' }, rig.runtime);
    const sent: string[] = [];
    const socket = rig.hooks()?.accept({
      send: (text) => sent.push(text),
      close: () => undefined,
      bufferedAmount: () => 0,
    });

    await socket?.message(authFrame(TOKEN));
    expect(sent.map((frame) => parseEnvelope(frame)?.topic)).toEqual(['hello']);
    expect((parseEnvelope(sent[0])?.data as PawSnapshot).planName).toBe('lore');

    daemon.bus.publish('processes', [{ pid: 9, ppid: 1, name: 'node' }]);
    expect(sent.map((frame) => parseEnvelope(frame)?.topic)).toEqual(['hello', 'processes']);
  });

  it('reports a session failure through the daemon’s own warning channel', async () => {
    let broken = false;
    const rig = makeRig({
      importModule: async () => {
        if (broken) {
          throw new Error('plan stopped parsing');
        }
        return { default: planNamed('lore') };
      },
    });
    const daemon = await runDaemon({}, rig.runtime);
    let buffered = 0;
    const socket = rig.hooks()?.accept({
      send: () => undefined,
      close: () => undefined,
      bufferedAmount: () => buffered,
    });
    await socket?.message(authFrame(TOKEN));

    // Go stale, then drain: the resync reloads the plan, which now fails.
    buffered = 2_000_000;
    daemon.bus.publish('processes', []);
    broken = true;
    await socket?.message(watchFrame('plans/lore.swarm.mjs'));
    buffered = 0;
    daemon.bus.publish('processes', []);
    await settle();

    expect(rig.warnings.some((line) => line.includes('plan stopped parsing'))).toBe(true);
    expect(rig.warnings.some((line) => line.startsWith('snapshot failed for'))).toBe(true);
  });

  it('closes its sessions with a shutdown code before the socket goes', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    const closed: Array<[number, string]> = [];
    const socket = rig.hooks()?.accept({
      send: () => undefined,
      close: (code, reason) => closed.push([code, reason]),
      bufferedAmount: () => 0,
    });
    await socket?.message(authFrame(TOKEN));

    await daemon.close();

    expect(closed).toEqual([[CLOSE_SHUTDOWN, 'pawd is shutting down']]);
  });

  it('drops a socket the peer closed, so the capacity gate stays honest', async () => {
    const rig = makeRig();
    await runDaemon({}, rig.runtime);
    const hooks = rig.hooks();
    const full = () =>
      hooks?.check({
        host: '127.0.0.1:8971',
        origin: undefined,
        protocols: [LIVE_SUBPROTOCOL],
      })?.status;

    const sockets = Array.from({ length: MAX_PREAUTH_SESSIONS }, () =>
      hooks?.accept({ send: () => undefined, close: () => undefined, bufferedAmount: () => 0 }),
    );
    expect(full()).toBe(429);

    sockets[0]?.closed();
    expect(full()).toBeUndefined();
  });

  it('closes an unauthenticated socket on the liveness tick', async () => {
    const rig = makeRig();
    await runDaemon({}, rig.runtime);
    const closed: Array<[number, string]> = [];
    rig.hooks()?.accept({
      send: () => undefined,
      close: (code, reason) => closed.push([code, reason]),
      bufferedAmount: () => 0,
    });

    rig.advance(AUTH_TIMEOUT_MS);
    rig.tickHost();

    expect(closed).toEqual([[CLOSE_MALFORMED, 'no credential offered in time']]);
  });

  it('publishes the herd as it lands, not only when the run is over', async () => {
    const rig = makeRig();
    let report: (event: DispatchEvent) => void = () => undefined;
    let finish: () => void = () => undefined;
    const running = new Promise<void>((done) => {
      finish = done;
    });

    const daemon = await runDaemon(
      {
        planPath: 'plans/lore.swarm.mjs',
        dispatch: async (_plan, onProgress) => {
          report = onProgress;
          await running;
          return {
            result: {
              released: true,
              findings: [],
              outcomes: [{ member: 0, key: 'a.mdx', state: 'done', content: 'out' }],
            },
            usage: { spendUsd: 0, tokensIn: 10, tokensOut: 20 },
          };
        },
      },
      rig.runtime,
    );

    const runs: RunProgress[] = [];
    daemon.bus.subscribe('run', (progress) => runs.push(progress));
    // The dispatch loads the plan before it calls the dispatcher, so the
    // progress sink is not wired until those awaits have settled.
    await settle();

    report({ phase: 'started', member: 0, key: 'a.mdx', total: 1 });
    expect(runs).toHaveLength(1);
    expect(runs[0].running).toBe(1);
    // The console shows a member working before it finishes. A four-hundred
    // member run against a real provider is otherwise blank for minutes, which
    // is indistinguishable from a console that has hung.
    expect((await daemon.snapshot('plans/lore.swarm.mjs')).run.running).toBe(1);

    report({
      phase: 'settled',
      member: 0,
      key: 'a.mdx',
      total: 1,
      outcome: { member: 0, key: 'a.mdx', state: 'done', content: 'out' },
    });
    expect(runs[1].done).toBe(1);
    expect(runs[1].running).toBe(0);

    finish();
    await daemon.dispatched;

    // The finished result is authoritative and must agree with what was shown.
    const final = await daemon.snapshot('plans/lore.swarm.mjs');
    expect(final.run.done).toBe(1);
    expect(final.run.running).toBe(0);
    expect(final.budget.tokensIn).toBe(10);
  });

  it('still reports a run correctly when the dispatcher says nothing as it goes', async () => {
    const rig = makeRig();
    const daemon = await runDaemon(
      {
        planPath: 'plans/lore.swarm.mjs',
        dispatch: async () => ({
          result: {
            released: true,
            findings: [],
            outcomes: [{ member: 0, key: 'a.mdx', state: 'skipped' }],
          },
          usage: { spendUsd: 0, tokensIn: 1, tokensOut: 2 },
        }),
      },
      rig.runtime,
    );
    await daemon.dispatched;

    expect((await daemon.snapshot('plans/lore.swarm.mjs')).run.skipped).toBe(1);
  });

  it('leaves no pollers behind when it cannot bind', async () => {
    const rig = makeRig({
      listen: async () => {
        throw new Error('EADDRINUSE: address already in use');
      },
    });

    await expect(runDaemon({ port: 8971 }, rig.runtime)).rejects.toThrow('EADDRINUSE');

    // The sources start before the bind. A daemon that failed to start must not
    // keep reading the process table every three seconds for the life of the
    // process — which is what happens without a teardown on this path.
    expect(rig.state.cancelled).toBe(true);
  });

  it('claims a failed run’s rejection before the caller can attach a handler', async () => {
    const rig = makeRig();
    const daemon = await runDaemon(
      {
        planPath: 'plans/lore.swarm.mjs',
        dispatch: async () => {
          throw new Error('the herd bolted');
        },
      },
      rig.runtime,
    );

    // Nothing attached a handler until now — one socket bind after the promise
    // was created. Unclaimed, Node would have exited on the rejection.
    await expect(daemon.dispatched).rejects.toThrow('the herd bolted');
  });

  it('stops polling and stops listening on close', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    await daemon.close();
    expect(rig.state.cancelled).toBe(true);
    expect(rig.state.closed).toBe(true);
  });

  it('reports zeros until a run is released', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({}, rig.runtime);
    expect(daemon.dispatched).toBeNull();
    const snapshot = await daemon.snapshot();
    expect(snapshot.run).toMatchObject({ done: 0, skipped: 0, members: [] });
    expect(snapshot.budget).toEqual({ spendUsd: 0, tokensIn: 0, tokensOut: 0 });
  });

  it('folds a released herd into the snapshot as it lands', async () => {
    const rig = makeRig();
    const daemon = await runDaemon(
      {
        planPath: 'plans/edit.swarm.mjs',
        dispatch: async (plan) => ({
          result: {
            released: true,
            findings: [],
            outcomes: [
              { member: 0, key: 'a.mdx', state: 'done', content: `${plan.name} wrote a` },
              { member: 1, key: 'b.mdx', state: 'skipped' },
            ],
          },
          usage: { spendUsd: 0, tokensIn: 120, tokensOut: 8 },
        }),
      },
      rig.runtime,
    );
    await daemon.dispatched;

    const snapshot = await daemon.snapshot();
    expect(snapshot.run).toMatchObject({ done: 1, skipped: 1, confirmed: 1 });
    expect(snapshot.budget).toEqual({ spendUsd: 0, tokensIn: 120, tokensOut: 8 });
  });

  it('refuses to release a herd when no plan was named to run', async () => {
    const rig = makeRig();
    const daemon = await runDaemon({ dispatch: async () => ({} as never) }, rig.runtime);
    await expect(daemon.dispatched).rejects.toThrow('no plan was named to run');
  });

  it('surfaces a failed run rather than reporting a run that never happened', async () => {
    const rig = makeRig();
    const daemon = await runDaemon(
      {
        planPath: 'plans/edit.swarm.mjs',
        dispatch: async () => {
          throw new Error('provider down');
        },
      },
      rig.runtime,
    );
    await expect(daemon.dispatched).rejects.toThrow('provider down');
    expect((await daemon.snapshot()).run).toMatchObject({ done: 0, members: [] });
  });

  it('fails loud when the config is not JSON', async () => {
    const rig = makeRig({ readFile: async () => 'not json' });
    await expect(runDaemon({}, rig.runtime)).rejects.toThrow();
  });
});
