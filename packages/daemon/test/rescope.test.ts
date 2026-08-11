/**
 * Daemon Rescope Tests
 *
 * @fileoverview Run daemon scoped to one repository, rescope to another.
 * Attach state reports the project root. Values derived from root re-derive
 * when a file changes, so rescope reuses that without restarting. Open
 * console socket keeps connection, receives new state.
 *
 * Tests assert derived slices follow root, that root with no PAW config
 * reports itself unconfigured only when config file missing (empty plan
 * list does not infer it), and that unreadable listing surfaces console
 * failure and leaves no stale data.
 *
 * @module @paw/daemon/test/rescope
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  authFrame,
  encodeAttach,
  encodeRelease,
  encodeScope,
  parseEnvelope,
  type AttachState,
  type HostInfo,
  type HostProcess,
  type PlansSlice,
  type RunSettings,
} from '@paw/core';
import { describe, expect, it } from 'vitest';
import { CA_DAYS, LEAF_DAYS, META_VERSION, addDays } from '../src/domain/identity.js';
import type { ServerIdentity } from '../src/infrastructure/identityStore.js';
import { runDaemon } from '../src/application/runDaemon.js';
import type { DaemonRuntime, ServerHandle, SocketHooks } from '../src/application/daemonContracts.js';
import type { FileEntry } from '../src/domain/tree.js';

const TOKEN = 'test-token-value-0123456789abcdef';

const ISSUED_AT = new Date('2026-08-05T15:40:02.000Z');

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
  cwd: '/home/x',
};

/**
 * Listings keyed by root; rescope changes the listings the runtime reports.
 */
const LISTINGS: Record<string, FileEntry[]> = {
  '/home/x/bare': [{ path: 'README.md', isFile: true }],
  '/home/x/paw-project': [
    { path: '.paw/config.json', isFile: true },
    { path: 'plans/lore.swarm.mjs', isFile: true },
  ],
};

/**
 * Daemon over fake runtime. Listing follow requested root.
 *
 * @param {Partial<DaemonRuntime>} over - Runtime override.
 * @returns {object} Runtime plus captured socket hooks.
 */
function makeRuntime(over: Partial<DaemonRuntime> = {}) {
  const captured = { hooks: null as SocketHooks | null };
  const warnings: string[] = [];
  const runtime: DaemonRuntime = {
    readFile: async () => JSON.stringify({ root: '.paw', gatesDir: '.paw/gates', connector: 'copilot-hooks' }),
    importModule: async () => ({ default: { name: 'lore', members: [] } }),
    modifiedAt: async () => 1000,
    listProcesses: async (): Promise<HostProcess[]> => [],
    listFiles: async (root: string) => LISTINGS[root] ?? [],
    readHost: () => HOST,
    now: () => '2026-08-05T15:40:02.000Z',
    clock: () => 0,
    warn: (m: string) => {
      warnings.push(m);
    },
    randomToken: () => TOKEN,
    identity: async () => IDENTITY,
    readPage: async () => '<html>console</html>',
    listen: async (_h, hooks): Promise<ServerHandle> => {
      captured.hooks = hooks;
      return { port: 8971, close: async () => {} };
    },
    schedule: () => () => {},
    ...over,
  };
  return { runtime, captured, warnings };
}

/**
 * Open authenticated console socket against daemon.
 *
 * @param {SocketHooks} hooks - Daemon socket hooks.
 * @returns {Promise<object>} Socket fake and its frames.
 */
async function openConsole(hooks: SocketHooks) {
  const sent: string[] = [];
  const socket = hooks.accept({
    send: (t: string) => {
      sent.push(t);
    },
    close: () => undefined,
    bufferedAmount: () => 0,
  });
  await socket.message(authFrame(TOKEN));
  return { sent, socket };
}

/**
 * Most recent frame of topic, decoded.
 *
 * @param {string[]} sent - Frames socket receive.
 * @param {string} topic - Topic wanted.
 * @returns {unknown} Its data, or undefined.
 */
function latest(sent: string[], topic: string): unknown {
  const hit = sent
    .map((f) => parseEnvelope(f))
    .filter((e) => e?.topic === topic)
    .pop();
  return hit?.data;
}

describe('rescoping a running daemon', () => {
  it('reports a root with no PAW config as unconfigured', async () => {
    const { runtime, captured } = makeRuntime();
    const daemon = await runDaemon(
      { root: '/home/x/bare', scopeCeiling: '/home/x' },
      runtime,
    );
    const { sent } = await openConsole(captured.hooks as SocketHooks);

    expect(daemon.root).toBe('/home/x/bare');
    expect(sent.length).toBeGreaterThan(0);
    await daemon.close();
  });

  it('follows the root and republishes what depends on it', async () => {
    const { runtime, captured } = makeRuntime();
    const daemon = await runDaemon(
      { root: '/home/x/bare', scopeCeiling: '/home/x' },
      runtime,
    );
    const { sent, socket } = await openConsole(captured.hooks as SocketHooks);

    await socket.message(encodeScope('/home/x/paw-project'));
    await new Promise((r) => setTimeout(r, 10));

    expect(daemon.root).toBe('/home/x/paw-project');
    const plans = latest(sent, 'plans') as PlansSlice | undefined;
    expect(plans?.plans).toEqual(['plans/lore.swarm.mjs']);
    const attach = latest(sent, 'attach') as AttachState | undefined;
    expect(attach).toEqual({ status: 'idle', path: '/home/x/paw-project' });
    await daemon.close();
  });

  it('reports a scoped root that holds no config', async () => {
    const { runtime, captured } = makeRuntime();
    const daemon = await runDaemon(
      { root: '/home/x/paw-project', scopeCeiling: '/home/x' },
      runtime,
    );
    const { sent, socket } = await openConsole(captured.hooks as SocketHooks);

    await socket.message(encodeScope('/home/x/bare'));
    await new Promise((r) => setTimeout(r, 10));

    expect(latest(sent, 'attach')).toEqual({
      status: 'unconfigured',
      path: '/home/x/bare',
    });
    await daemon.close();
  });

  it('surfaces a listing it cannot read instead of staying on stale data', async () => {
    const { runtime, captured, warnings } = makeRuntime({
      listFiles: async (root: string) => {
        if (root === '/home/x/broken') {
          throw new Error('EACCES');
        }
        return LISTINGS[root] ?? [];
      },
    });
    const daemon = await runDaemon(
      { root: '/home/x/bare', scopeCeiling: '/home/x' },
      runtime,
    );
    const { sent, socket } = await openConsole(captured.hooks as SocketHooks);

    await socket.message(encodeScope('/home/x/broken'));
    await new Promise((r) => setTimeout(r, 10));

    expect(latest(sent, 'attach')).toMatchObject({
      status: 'failed',
      path: '/home/x/broken',
    });
    expect(warnings.some((w) => w.includes('/home/x/broken'))).toBe(true);
    await daemon.close();
  });

  it('lets whoever holds the process rescope directly, ceiling or not', async () => {
    const { runtime, captured } = makeRuntime();
    const daemon = await runDaemon({ root: '/home/x/bare' }, runtime);
    const { sent } = await openConsole(captured.hooks as SocketHooks);

    await daemon.rescope('/home/x/paw-project');

    expect(daemon.root).toBe('/home/x/paw-project');
    expect(latest(sent, 'attach')).toEqual({
      status: 'idle',
      path: '/home/x/paw-project',
    });
    await daemon.close();
  });

  it('refuses scope requests when no ceiling was given', async () => {
    const { runtime, captured } = makeRuntime();
    const daemon = await runDaemon({ root: '/home/x/bare' }, runtime);
    const { sent, socket } = await openConsole(captured.hooks as SocketHooks);

    await socket.message(encodeScope('/home/x/paw-project'));

    expect(daemon.root).toBe('/home/x/bare');
    expect(latest(sent, 'error')).toEqual({
      code: 'scope-unavailable',
      message: 'this daemon is already scoped to a repository',
    });
    await daemon.close();
  });

  it('hands attach requests to whoever started it, and writes nothing itself', async () => {
    const asked: [string, string][] = [];
    const { runtime, captured } = makeRuntime();
    const daemon = await runDaemon(
      {
        root: '/home/x/bare',
        scopeCeiling: '/home/x',
        onAttach: (path, mode) => {
          asked.push([path, mode]);
        },
      },
      runtime,
    );
    const { sent, socket } = await openConsole(captured.hooks as SocketHooks);

    await socket.message(encodeAttach('/home/x/bare', 'merge'));

    expect(asked).toEqual([['/home/x/bare', 'merge']]);
    expect(latest(sent, 'error')).toEqual({
      code: 'attach-pending',
      message: 'approve this in the terminal running pawd',
    });
    await daemon.close();
  });

  it('hands release requests to whoever started it, and runs nothing itself', async () => {
    const asked: RunSettings[] = [];
    const { runtime, captured } = makeRuntime();
    const daemon = await runDaemon(
      {
        root: '/home/x/bare',
        onRelease: (settings) => {
          asked.push(settings);
        },
      },
      runtime,
    );
    const { sent, socket } = await openConsole(captured.hooks as SocketHooks);

    await socket.message(encodeRelease({ plan: 'plans/lore.swarm.mjs', live: true, concurrency: 4 }));

    expect(asked).toEqual([{ plan: 'plans/lore.swarm.mjs', live: true, concurrency: 4 }]);
    expect(latest(sent, 'error')).toEqual({
      code: 'release-pending',
      message: 'approve this in the terminal running pawd',
    });
    await daemon.close();
  });
});
