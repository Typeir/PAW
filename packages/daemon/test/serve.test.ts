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

import type { HostInfo, HostProcess, PawSnapshot, SwarmPlan } from '@paw/core';
import { describe, expect, it, vi } from 'vitest';
import { CA_DAYS, LEAF_DAYS, META_VERSION, addDays } from '../src/identity.js';
import type { ServerIdentity } from '../src/identityStore.js';
import { UnknownPlanError } from '../src/plans.js';
import type { HttpRequest, HttpResponse } from '../src/router.js';
import {
  LOOPBACK,
  modelCount,
  runDaemon,
  toPlan,
  underRoot,
  type DaemonRuntime,
  type ServerHandle,
  type TlsMaterial,
} from '../src/serve.js';
import type { FileEntry } from '../src/tree.js';

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
 * @property {() => void} tick - Fire the scheduled poll once.
 * @property {{ closed: boolean; cancelled: boolean; tls: TlsMaterial | null }} state - Teardown flags and the certificate the daemon bound with.
 * @property {string[]} imported - Every module path the daemon imported, in order.
 */
interface Rig {
  readonly runtime: DaemonRuntime;
  handler(): Handler | null;
  tick(): void;
  readonly state: { closed: boolean; cancelled: boolean; tls: TlsMaterial | null };
  readonly imported: string[];
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
  let handler: Handler | null = null;
  let scheduled: (() => void) | null = null;
  const state = { closed: false, cancelled: false, tls: null as TlsMaterial | null };
  const imported: string[] = [];

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
    randomToken: () => TOKEN,
    identity: async () => IDENTITY,
    readPage: async () => '<html>console</html>',
    listen: async (h, _port, _host, tls): Promise<ServerHandle> => {
      handler = h;
      state.tls = tls;
      return {
        port: 8971,
        close: async () => {
          state.closed = true;
        },
      };
    },
    schedule: (fn) => {
      scheduled = fn;
      return () => {
        state.cancelled = true;
      };
    },
    ...over,
  };

  return { runtime, handler: () => handler, tick: () => scheduled?.(), state, imported };
}

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
    expect(listen).toHaveBeenCalledWith(expect.any(Function), 0, LOOPBACK, {
      cert: IDENTITY.cert,
      key: IDENTITY.key,
    });
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
    expect(listen).toHaveBeenCalledWith(expect.any(Function), 9090, LOOPBACK, {
      cert: IDENTITY.cert,
      key: IDENTITY.key,
    });
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
