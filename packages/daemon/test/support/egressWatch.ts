/**
 * PAW Daemon Test Egress Watch
 *
 * @fileoverview Records network egress from this process and its descendants:
 * a refusing HTTP proxy, installed through the `*_PROXY` variables children
 * inherit, logs every proxied request line; a `netstat -ano` poll logs every
 * non-loopback TCP endpoint, kept when its pid ever joined the tree. One
 * PowerShell session streams the process table, about every 200 ms. Windows
 * only. A descendant living under one snapshot escapes the poll, not the proxy.
 *
 * @module @paw/daemon/test/support/egressWatch
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Proxy variables child processes read, in both casings.
 */
const PROXY_VARS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy'];

/**
 * Bypass variables, in both casings.
 */
const NO_PROXY_VARS = ['NO_PROXY', 'no_proxy'];

/**
 * Remote endpoints that never leave the machine.
 */
const LOCAL_REMOTE = /^(127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1?\]):\d+$|^\*:\*$/;

/**
 * Socket error codes of a peer hanging up; neither egress nor failure.
 */
const HANGUP = new Set(['ECONNRESET', 'EPIPE']);

/**
 * Connection poll period, milliseconds.
 */
const POLL_MS = 150;

/**
 * PowerShell loop printing one process-table snapshot per line: `pid:ppid:name`
 * rows joined by `|`, two characters no image name can hold.
 */
const SNAPSHOT_SCRIPT =
  "$ErrorActionPreference = 'Stop'; while ($true) { $rows = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name | ForEach-Object { '{0}:{1}:{2}' -f $_.ProcessId, $_.ParentProcessId, $_.Name }; [Console]::Out.WriteLine($rows -join '|'); [Console]::Out.Flush() }";

/**
 * Longest the TCP control holds its connection waiting to be seen, milliseconds.
 */
const CONTROL_DEADLINE_MS = 10_000;

/**
 * Host the proxy control asks for; `.invalid` never resolves.
 */
const CONTROL_HOST = 'egress-watch.invalid';

/**
 * Egress observed since the last reset.
 *
 * @interface EgressReport
 * @property {readonly string[]} proxied - Request lines the proxy refused, e.g. `CONNECT api.github.com:443 HTTP/1.1`.
 * @property {readonly string[]} connections - Non-loopback TCP endpoints of the tree, as `<remote> pid=<pid> <state>`.
 * @property {readonly string[]} failures - Poll, proxy, and control socket errors since start; never reset.
 * @property {readonly string[]} processes - Image names that ever joined the tree, e.g. `copilot-runtime.exe`; never reset.
 */
export interface EgressReport {
  readonly proxied: readonly string[];
  readonly connections: readonly string[];
  readonly failures: readonly string[];
  readonly processes: readonly string[];
}

/**
 * Running egress watch.
 *
 * @interface EgressWatch
 * @property {() => Promise<void>} prove - Make one TCP and one proxied event; throws unless both are seen.
 * @property {() => void} reset - Clear `proxied` and `connections`.
 * @property {() => EgressReport} report - Snapshot since the last reset.
 * @property {() => Promise<void>} stop - Stop polling, close the proxy, restore the environment.
 */
export interface EgressWatch {
  prove(): Promise<void>;
  reset(): void;
  report(): EgressReport;
  stop(): Promise<void>;
}

/**
 * Record a socket's errors in `failures`, except a peer hanging up.
 *
 * @param {net.Socket} socket - Socket to watch.
 * @param {string} label - Prefix naming the socket in a failure.
 * @param {string[]} failures - Receives the failures.
 * @returns {net.Socket} The same socket.
 */
function reportErrors(socket: net.Socket, label: string, failures: string[]): net.Socket {
  return socket.on('error', (err: NodeJS.ErrnoException) => {
    if (!HANGUP.has(err.code ?? '')) {
      failures.push(`${label}: ${err.message}`);
    }
  });
}

/**
 * First non-internal IPv4 address of this machine.
 *
 * @returns {string} The address.
 * @throws {Error} When no interface carries one.
 */
function externalIpv4(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    const hit = addresses?.find((a) => a.family === 'IPv4' && !a.internal);
    if (hit !== undefined) {
      return hit.address;
    }
  }
  throw new Error('egress watch: no non-loopback IPv4 interface to prove the TCP poll against');
}

/**
 * One process-table row.
 *
 * @interface ProcessRow
 * @property {number} pid - Process id.
 * @property {number} ppid - Parent process id.
 * @property {string} name - Image name.
 */
interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
}

/**
 * Rows descending from `root`, root included when listed.
 *
 * @param {number} root - Root process id.
 * @param {readonly ProcessRow[]} rows - Process table.
 * @returns {ProcessRow[]} Root and every descendant row.
 */
function descendantsOf(root: number, rows: readonly ProcessRow[]): ProcessRow[] {
  const tree = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (tree.has(row.ppid) && !tree.has(row.pid)) {
        tree.add(row.pid);
        grew = true;
      }
    }
  }
  return rows.filter((row) => tree.has(row.pid));
}

/**
 * Every non-loopback TCP endpoint in `netstat -ano` output, with its owner.
 *
 * @param {string} netstat - Command output.
 * @returns {Array<[string, number]>} Endpoint as `<remote> pid=<pid> <state>`, and its pid.
 */
function foreignEndpoints(netstat: string): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const line of netstat.split(/\r?\n/)) {
    const [proto, , remote, state, pid] = line.trim().split(/\s+/);
    if (proto === 'TCP' && !LOCAL_REMOTE.test(remote)) {
      out.push([`${remote} pid=${pid} ${state}`, Number(pid)]);
    }
  }
  return out;
}

/**
 * Rows of one snapshot line.
 *
 * @param {string} line - `pid:ppid:name` rows joined by `|`.
 * @returns {ProcessRow[]} One row per process.
 */
function snapshotRows(line: string): ProcessRow[] {
  return line
    .split('|')
    .filter((row) => row.length > 0)
    .map((row) => {
      const [pid, ppid, name] = row.split(':');
      return { pid: Number(pid), ppid: Number(ppid), name };
    });
}

/**
 * Start the snapshot loop and resolve on its first snapshot.
 *
 * @param {(rows: readonly ProcessRow[]) => void} onSnapshot - Receives every snapshot.
 * @param {string[]} failures - Receives stderr output and an exit while running.
 * @returns {Promise<ChildProcess>} The running loop.
 * @throws {Error} When the loop exits or fails to start before its first snapshot.
 */
async function streamSnapshots(
  onSnapshot: (rows: readonly ProcessRow[]) => void,
  failures: string[],
): Promise<ChildProcess> {
  const loop = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SNAPSHOT_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  loop.stderr.on('data', (chunk: Buffer) => failures.push(`process snapshots: ${chunk.toString('utf8').trim()}`));
  const lines = createInterface({ input: loop.stdout });
  lines.on('line', (line) => onSnapshot(snapshotRows(line)));
  await new Promise<void>((resolve, reject) => {
    lines.once('line', () => resolve());
    loop.once('error', reject);
    loop.once('exit', (code) => reject(new Error(`egress watch: process snapshots exited with code ${code} before the first snapshot`)));
  });
  loop.on('exit', (code) => {
    if (!loop.killed) {
      failures.push(`process snapshots: exited with code ${code}`);
    }
  });
  return loop;
}

/**
 * Wait the given time.
 *
 * @param {number} ms - Milliseconds.
 * @returns {Promise<void>} Resolves after `ms`.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Close a server, rejecting on a close error.
 *
 * @param {net.Server} server - Server to close.
 * @returns {Promise<void>} Resolves once closed.
 */
function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

/**
 * Prove the TCP poll: hold one connection to this machine's own LAN address
 * until the watch reports it, or the deadline passes.
 *
 * @param {() => readonly string[]} connections - Current attributed endpoints.
 * @param {string[]} failures - Receives control socket errors.
 * @returns {Promise<string | null>} Null when seen; otherwise what was missed.
 */
async function proveTcp(connections: () => readonly string[], failures: string[]): Promise<string | null> {
  const address = externalIpv4();
  const server = net.createServer((socket) => {
    reportErrors(socket, 'tcp control (server side)', failures).on('end', () => socket.end());
  });
  server.listen(0, address);
  await once(server, 'listening');
  const client = reportErrors(
    net.connect((server.address() as net.AddressInfo).port, address),
    'tcp control (client side)',
    failures,
  );
  await once(client, 'connect');
  const seen = (): boolean => connections().some((e) => e.startsWith(`${address}:`) && e.includes(`pid=${process.pid} `));
  for (let waited = 0; !seen() && waited < CONTROL_DEADLINE_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
  }
  const hit = seen();
  client.end();
  await once(client, 'close');
  await closeServer(server);
  return hit ? null : `tcp poll missed a connection to ${address} held for ${CONTROL_DEADLINE_MS} ms`;
}

/**
 * Prove the proxy: run `curl` against an `.invalid` host and look for its
 * CONNECT line. The proxy refuses it, so nothing leaves the machine.
 *
 * @param {readonly string[]} proxied - Request lines the proxy has logged.
 * @returns {Promise<string | null>} Null when seen; otherwise what was missed.
 */
async function proveProxy(proxied: readonly string[]): Promise<string | null> {
  const curl = spawn('curl.exe', ['-s', '-o', 'NUL', '-m', '5', `https://${CONTROL_HOST}/`], { stdio: 'ignore' });
  await once(curl, 'exit');
  return proxied.some((line) => line.startsWith(`CONNECT ${CONTROL_HOST}:443 `))
    ? null
    : `proxy missed curl's CONNECT ${CONTROL_HOST}:443`;
}

/**
 * Start watching egress. Installs the proxy variables in `process.env` until `stop`.
 *
 * @returns {Promise<EgressWatch>} The running watch.
 * @throws {Error} Off Windows: the watch reads `netstat -ano` and `Win32_Process`.
 */
export async function startEgressWatch(): Promise<EgressWatch> {
  if (process.platform !== 'win32') {
    throw new Error(`egress watch reads netstat -ano and Win32_Process; it runs on Windows, not ${process.platform}`);
  }
  const proxied: string[] = [];
  const seen = new Map<string, number>();
  const failures: string[] = [];
  const open = new Set<net.Socket>();
  const saved = new Map(
    [...PROXY_VARS, ...NO_PROXY_VARS].map((name): [string, string | undefined] => [name, process.env[name]]),
  );

  const proxy = net.createServer((socket) => {
    open.add(socket);
    reportErrors(socket, 'proxy socket', failures).on('close', () => open.delete(socket));
    socket.once('data', (chunk: Buffer) => {
      proxied.push(chunk.toString('latin1').split('\r\n')[0]);
      socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n');
    });
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
  for (const name of PROXY_VARS) {
    process.env[name] = proxyUrl;
  }
  for (const name of NO_PROXY_VARS) {
    process.env[name] = '127.0.0.1,localhost,::1';
  }

  const tree = new Map<number, string>([[process.pid, 'self']]);
  const grow = (rows: readonly ProcessRow[]): void => {
    for (const row of descendantsOf(process.pid, rows)) {
      tree.set(row.pid, row.name);
    }
  };
  const snapshots = await streamSnapshots(grow, failures);
  let polling = true;
  const pollLoop = (async () => {
    while (polling) {
      try {
        const { stdout } = await run('netstat', ['-ano'], { maxBuffer: 1 << 24 });
        for (const [endpoint, pid] of foreignEndpoints(stdout)) {
          seen.set(endpoint, pid);
        }
      } catch (err: unknown) {
        failures.push(`netstat: ${String(err)}`);
      }
      await sleep(POLL_MS);
    }
  })();
  const connections = (): string[] => [...seen].filter(([, pid]) => tree.has(pid)).map(([endpoint]) => endpoint);

  return {
    async prove(): Promise<void> {
      const missed = [await proveTcp(connections, failures), await proveProxy(proxied)].filter((m) => m !== null);
      if (missed.length > 0) {
        throw new Error(`egress watch failed its own controls: ${missed.join('; ')}`);
      }
    },
    reset(): void {
      proxied.length = 0;
      seen.clear();
    },
    report(): EgressReport {
      return {
        proxied: [...proxied],
        connections: connections(),
        failures: [...failures],
        processes: [...new Set(tree.values())].sort(),
      };
    },
    async stop(): Promise<void> {
      polling = false;
      await pollLoop;
      if (snapshots.exitCode === null && snapshots.signalCode === null) {
        snapshots.kill();
        await once(snapshots, 'exit');
      }
      for (const socket of open) {
        socket.destroy();
      }
      await closeServer(proxy);
      for (const [name, value] of saved) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    },
  };
}
