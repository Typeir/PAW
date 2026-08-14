/**
 * Console Endpoint Tests
 *
 * @fileoverview Cover the attach record: path shape, record/read round-trip
 * over a real temp filesystem, corrupt and incomplete records read as null,
 * filesystem failures on record swallowed. Probe runs against a real TLS
 * daemon: live record probes true, wrong token and wrong fingerprint probe
 * false, a closed daemon probes false, and a socket that accepts but never
 * answers TLS probes false on the timeout.
 *
 * @module @paw/daemon/test/consoleEndpoint
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DaemonHandle } from '../src/application/daemonContracts.js';
import { runDaemon } from '../src/application/runDaemon.js';
import { consolePage } from '../src/domain/consolePage.js';
import { nodeRuntime } from '../src/infrastructure/nodeRuntime.js';
import {
  consoleEndpointPath,
  postRunReport,
  probeConsoleEndpoint,
  readConsoleEndpoint,
  recordConsoleEndpoint,
  type ConsoleEndpoint,
} from '../src/infrastructure/consoleEndpoint.js';

const dirs: string[] = [];
const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'paw-endpoint-'));
  dirs.push(dir);
  return dir;
};

const RECORD: ConsoleEndpoint = {
  url: 'https://127.0.0.1:8971/',
  token: 'a-token',
  fingerprint: 'SHA256:AA:BB',
  pid: 4242,
};

describe('console endpoint record', () => {
  afterAll(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lives in the repo .paw directory', () => {
    expect(consoleEndpointPath('/repo')).toBe(join('/repo', '.paw', 'console.endpoint.json'));
  });

  it('round-trips a record, creating .paw when missing', () => {
    const root = tempRoot();
    recordConsoleEndpoint(root, RECORD);
    expect(readConsoleEndpoint(root)).toEqual(RECORD);
  });

  it('reads null when the record is missing, corrupt, or incomplete', () => {
    expect(readConsoleEndpoint(tempRoot())).toBeNull();
    const corrupt = tempRoot();
    recordConsoleEndpoint(corrupt, RECORD);
    writeFileSync(consoleEndpointPath(corrupt), 'not json', 'utf8');
    expect(readConsoleEndpoint(corrupt)).toBeNull();
    const incomplete = tempRoot();
    recordConsoleEndpoint(incomplete, RECORD);
    writeFileSync(consoleEndpointPath(incomplete), JSON.stringify({ url: 'x' }), 'utf8');
    expect(readConsoleEndpoint(incomplete)).toBeNull();
  });

  it('swallows a filesystem failure on record', () => {
    const root = tempRoot();
    writeFileSync(join(root, '.paw'), 'a file where the directory should be', 'utf8');
    expect(() => recordConsoleEndpoint(root, RECORD)).not.toThrow();
  });
});

describe('console endpoint probe, against a real daemon', () => {
  let previousHome: string | undefined;
  let daemon: DaemonHandle;
  let live: ConsoleEndpoint;

  beforeAll(async () => {
    previousHome = process.env.PAW_HOME;
    process.env.PAW_HOME = await mkdtemp(join(tmpdir(), 'paw-home-'));
    daemon = await runDaemon({ root: await mkdtemp(join(tmpdir(), 'paw-repo-')) }, nodeRuntime(consolePage()));
    live = {
      url: daemon.url,
      token: daemon.token,
      fingerprint: daemon.identity.meta.leafFingerprint,
      pid: process.pid,
    };
  }, 30000);

  afterAll(async () => {
    await daemon.close();
    if (previousHome === undefined) {
      delete process.env.PAW_HOME;
    } else {
      process.env.PAW_HOME = previousHome;
    }
  });

  it('answers true for the live daemon it recorded', async () => {
    expect(await probeConsoleEndpoint(live)).toBe(true);
  });

  it('folds a reported external-herd event into the run slice', async () => {
    const accepted = await postRunReport(live, {
      id: '15-40-02',
      at: '2026-08-14T15:40:02.000Z',
      event: { phase: 'started', member: 0, key: 'src/a.ts' } as never,
    });
    expect(accepted).toBe(true);
    const settledEvent = await postRunReport(live, {
      id: '15-40-02',
      at: '2026-08-14T15:40:02.000Z',
      event: {
        phase: 'settled',
        member: 0,
        key: 'src/a.ts',
        outcome: { state: 'done', content: 'edited' },
      } as never,
    });
    expect(settledEvent).toBe(true);
    const snap = await daemon.snapshot();
    expect(snap.run.id).toBe('15-40-02');
    expect(snap.run.done).toBe(1);
    expect(snap.run.confirmed).toBe(1);
    expect(snap.run.members[0]).toMatchObject({ member: 0, key: 'src/a.ts', state: 'done' });
  });

  it('refuses a report without member and key, and one with a stale token', async () => {
    expect(
      await postRunReport(live, { id: 'x', at: 'now', event: {} as never }),
    ).toBe(false);
    expect(
      await postRunReport(
        { ...live, token: 'stale' },
        { id: 'x', at: 'now', event: { phase: 'started', member: 0, key: 'k' } as never },
      ),
    ).toBe(false);
  });

  it('answers false for a wrong token and a wrong fingerprint', async () => {
    expect(await probeConsoleEndpoint({ ...live, token: 'stale-token' })).toBe(false);
    expect(await probeConsoleEndpoint({ ...live, fingerprint: 'SHA256:00:11' })).toBe(false);
  });

  it('answers false for a socket nobody serves', async () => {
    expect(await probeConsoleEndpoint({ ...live, url: 'https://127.0.0.1:9/' })).toBe(false);
  });

  it('answers false on the timeout for a socket that accepts and says nothing', async () => {
    const held: Socket[] = [];
    const silent: Server = createServer((socket) => held.push(socket));
    await new Promise<void>((resolveListen) => silent.listen(0, '127.0.0.1', resolveListen));
    const port = (silent.address() as { port: number }).port;
    expect(
      await probeConsoleEndpoint({ ...live, url: `https://127.0.0.1:${port}/` }, 300),
    ).toBe(false);
    for (const socket of held) {
      socket.destroy();
    }
    silent.close();
  });
});
