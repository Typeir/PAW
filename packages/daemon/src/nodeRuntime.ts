/**
 * PAW Daemon Node Runtime
 *
 * @fileoverview The real effects behind {@link DaemonRuntime}: the filesystem, a
 * dynamic import, the live host process table via `ps-list`, `process`/`os`, and
 * a `node:http` server on loopback. It is the driven adapter for the daemon —
 * the only file in the package that touches the outside world, and thin by
 * design, because everything worth deciding was decided in `serve.ts`. It is
 * covered by an integration test that binds a real port and fetches real state
 * rather than by an exclusion.
 *
 * The page it serves is `@paw/gui`'s `dist/live.html` — the React console with
 * no snapshot injected, so it fetches `/api/state` and keeps polling. When the
 * GUI has not been built, a dependency-free bootstrap page proves the data is
 * real in a browser instead.
 *
 * @module @paw/daemon/nodeRuntime
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { randomBytes } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { STATUS_CODES, type IncomingMessage } from 'node:http';
import { createServer, type Server as TlsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import psList from 'ps-list';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CLOSE_MALFORMED,
  LIVE_SUBPROTOCOL,
  MAX_FRAME_BYTES,
  PING_MS,
  PONG_TIMEOUT_MS,
  type HostProcess,
} from '@paw/core';
import { readHostInfo } from './host.js';
import { nodeServerIdentity } from './infrastructure/nodeIdentity.js';
import { collectSubtree } from './infrastructure/process.js';
import type { HttpRequest, HttpResponse } from './router.js';
import { TOKEN_BYTES, type UpgradeRefusal } from './infrastructure/security.js';
import type {
  AcceptedSocket,
  DaemonRuntime,
  ServerHandle,
  SocketHooks,
  TlsMaterial,
} from './serve.js';
import type { WsSessionPort } from './sessions.js';
import { IGNORED_DIRS, type FileEntry } from './tree.js';

/**
 * How long a client may take to send its request headers. Node's default is
 * generous enough to hold a connection open indefinitely with a trickle of
 * bytes; a loopback daemon has no reason to wait that long for anyone.
 */
const HEADERS_TIMEOUT_MS = 5_000;

/**
 * How long a whole request may take to arrive.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The oldest TLS this daemon will negotiate. 1.2 is the floor rather than 1.3
 * because a pinned Electron and a current browser both reach 1.3 on their own,
 * and refusing 1.2 outright would only break tooling without closing an attack.
 */
const MIN_TLS = 'TLSv1.2';

/**
 * The IPv6 loopback address. Bound in addition to IPv4 because `localhost`
 * resolves to `::1` first on Windows and on most current Linux configurations —
 * a v4-only daemon is a daemon half the URLs cannot reach.
 */
export const LOOPBACK_V6 = '::1';

/**
 * Tell the operator something that must not stop the daemon. The one place this
 * package writes to stderr, so a socket failure and a source failure are
 * reported identically and there is no second reporter to drift from this one.
 *
 * @param {string} message - What happened.
 */
export function report(message: string): void {
  process.stderr.write(`pawd: ${message}\n`);
}

/**
 * A no-framework page that fetches `/api/state` and shows the real host, the
 * owned processes, and the doctor — served when `@paw/gui` has not been built.
 */
export const BOOTSTRAP = `<!doctype html><html><head><meta charset="utf-8"><title>pawd</title>
<style>body{background:#0b0e13;color:#e7ecf3;font:13px ui-monospace,monospace;margin:0;padding:24px}
h1{color:#e79a3c;font-size:15px}h2{color:#93a0b2;font-size:12px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.1em}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:3px 12px 3px 0;border-bottom:1px solid #1a222d}
.ok{color:#40b498}.bad{color:#d75c55}</style></head><body>
<h1>pawd · live</h1><div id="app">loading /api/state…</div>
<script>
fetch('/api/state').then(function(r){return r.json()}).then(function(s){
  var h=s.host, rows=s.processes.slice(0,40).map(function(p){return '<tr><td>'+p.pid+'</td><td>'+p.ppid+'</td><td>'+p.name+'</td></tr>'}).join('');
  var roles=s.doctor.roles.map(function(r){return '<tr><td>'+r.role+'</td><td>'+(r.boundTo||'(unbound)')+'</td><td class="'+(r.blocking?'bad':'ok')+'">'+(r.blocking?'blocked':'ok')+'</td></tr>'}).join('');
  document.getElementById('app').innerHTML =
    '<h2>host</h2>pid '+h.pid+' · ppid '+h.ppid+' · up '+h.uptimeSec+'s · rss '+Math.round(h.rssBytes/1048576)+'MB · '+h.hostname+' · '+h.platform+' '+h.release+' · '+h.cpus+' cpus · node '+h.node+
    '<h2>plan · '+s.planName+' ('+s.memberTotal+' members, role '+s.planRole+')</h2>'+
    '<div class="'+(s.doctor.ok?'ok':'bad')+'">doctor: '+(s.doctor.ok?'ready':'NOT ready')+'</div>'+
    '<table>'+roles+'</table>'+
    '<h2>PAW processes — owned subtree ('+s.processes.length+')</h2><table><tr><th>pid</th><th>ppid</th><th>name</th></tr>'+rows+'</table>';
}).catch(function(e){document.getElementById('app').textContent='error: '+e});
</script></body></html>`;

/**
 * The method and path of an incoming request, with Node's optional fields
 * resolved. A request line is pure data, so deciding what it means lives here
 * rather than inside the socket callback where no test can reach it.
 *
 * @param {string | undefined} method - `req.method`.
 * @param {string | undefined} url - `req.url`.
 * @param {string} host - The bound host, to resolve the URL against.
 * @returns {{ method: string; path: string }} The routed target.
 */
export function requestTarget(
  method: string | undefined,
  url: string | undefined,
  host: string,
): { method: string; path: string; query: URLSearchParams } {
  // A parse base for a relative request line, never a scheme this daemon speaks:
  // `new URL` needs an absolute base and the result is read for path and query
  // only. The daemon serves https and wss exclusively.
  const parsed = new URL(url ?? '/', `http://${host}`);
  return {
    method: method ?? 'GET',
    path: parsed.pathname,
    query: parsed.searchParams,
  };
}

/**
 * The first value of a header Node may have parsed into a list. A repeated
 * `Host` or `Origin` is a smuggling smell rather than a merge candidate, so the
 * first wins and the rest are ignored — the security gates then judge one
 * unambiguous value.
 *
 * @param {string | string[] | undefined} value - The parsed header.
 * @returns {string | undefined} The single value.
 */
export function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Assemble the request the router reads from Node's incoming message.
 *
 * @param {IncomingMessage} req - The incoming request.
 * @param {string} host - The bound host, to resolve a relative URL against.
 * @returns {HttpRequest} The routed request.
 */
export function toRequest(req: IncomingMessage, host: string): HttpRequest {
  const target = requestTarget(req.method, req.url, host);
  return {
    method: target.method,
    path: target.path,
    query: target.query,
    headers: {
      authorization: firstHeader(req.headers.authorization),
      origin: firstHeader(req.headers.origin),
      host: firstHeader(req.headers.host),
    },
  };
}

/**
 * The port a server actually bound. Node reports an object for a TCP socket and
 * a string for a pipe; the requested port is the fallback for anything else.
 *
 * @param {string | { port: number } | null} address - `server.address()`.
 * @param {number} fallback - The port that was requested.
 * @returns {number} The bound port.
 */
export function boundPort(address: string | { port: number } | null, fallback: number): number {
  return address !== null && typeof address === 'object' ? address.port : fallback;
}

/**
 * Walk a directory tree into the flat listing {@link buildFileTree} nests,
 * pruning the directories nobody browses as it goes so a repository with a
 * `node_modules` is not read into memory to be thrown away. Paths come back
 * relative to the walked root and always with `/`, which is the form the tree
 * and the selector both speak.
 *
 * @param {string} root - The absolute directory to walk.
 * @param {string} [prefix] - The relative prefix accumulated so far.
 * @returns {Promise<FileEntry[]>} The listing.
 */
export async function walkFiles(root: string, prefix = ''): Promise<FileEntry[]> {
  const dirents = await readdir(join(root, prefix), { withFileTypes: true });
  const out: FileEntry[] = [];
  for (const dirent of dirents) {
    if (dirent.isDirectory() && IGNORED_DIRS.includes(dirent.name)) {
      continue;
    }
    const path = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) {
      out.push({ path, isFile: false });
      out.push(...(await walkFiles(root, path)));
      continue;
    }
    if (dirent.isFile()) {
      out.push({ path, isFile: true });
    }
  }
  return out;
}

/**
 * Narrow one `ps-list` row to the three fields the control API discloses. A row
 * whose parent the OS did not report is rooted at 0, which leaves it outside
 * PAW's subtree — the safe direction, since the subtree is what gets served.
 *
 * @param {{ pid: number; ppid?: number; name: string }} proc - The `ps-list` row.
 * @returns {HostProcess} The disclosed process.
 */
export function toHostProcess(proc: { pid: number; ppid?: number; name: string }): HostProcess {
  return { pid: proc.pid, ppid: proc.ppid ?? 0, name: proc.name };
}

/**
 * A TLS server that answers with the router, refuses to hold a connection open
 * on a trickle of header bytes, and never tells a client why a request failed —
 * an error message from a control API is reconnaissance.
 *
 * @param {TlsMaterial} tls - The certificate and key to present.
 * @param {(request: HttpRequest) => Promise<HttpResponse>} handler - The router.
 * @param {string} host - The bound host, to resolve a relative URL against.
 * @returns {TlsServer} The unbound server.
 */
export function createConsoleServer(
  tls: TlsMaterial,
  handler: (request: HttpRequest) => Promise<HttpResponse>,
  host: string,
): TlsServer {
  const server = createServer({ cert: tls.cert, key: tls.key, minVersion: MIN_TLS }, (req, res) => {
    void handler(toRequest(req, host)).then(
      (routed) => {
        res.writeHead(routed.status, routed.headers);
        res.end(routed.body);
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`pawd: request failed: ${message}\n`);
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('internal error');
      },
    );
  });
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

/**
 * The subprotocols a client offered, from the raw header. A comma-separated
 * list is the wire format; an absent header means it offered none, which the
 * upgrade gate refuses.
 *
 * @param {string | undefined} header - `Sec-WebSocket-Protocol`.
 * @returns {string[]} The offered subprotocols.
 */
export function offeredProtocols(header: string | undefined): string[] {
  if (header === undefined) {
    return [];
  }
  return header
    .split(',')
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol !== '');
}

/**
 * Refuse an upgrade while it is still plain HTTP.
 *
 * The response is written by hand because there is no `ServerResponse` for an
 * upgrade — Node hands over the raw socket. `Connection: close` and an explicit
 * `Content-Length` are both required: without them a client waits for a body
 * that never comes, and "the daemon hung" is a much worse diagnosis than "403".
 *
 * @param {Duplex} socket - The raw socket.
 * @param {UpgradeRefusal} refusal - Why.
 */
export function refuseUpgrade(socket: Duplex, refusal: UpgradeRefusal): void {
  const body = refusal.message;
  socket.write(
    `HTTP/1.1 ${refusal.status} ${STATUS_CODES[refusal.status] ?? 'Error'}\r\n` +
      'content-type: text/plain; charset=utf-8\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      'connection: close\r\n' +
      '\r\n' +
      body,
  );
  socket.destroy();
}

/**
 * Wire an upgraded socket to the daemon's session machine, and keep it honest
 * with a heartbeat.
 *
 * The heartbeat is a ping every {@link PING_MS} with a hard
 * {@link PONG_TIMEOUT_MS} deadline, and a missed deadline **terminates** rather
 * than closes: a client that has stopped answering is not going to complete a
 * closing handshake either, and waiting for one leaks the session.
 *
 * Binary frames are refused outright. This protocol is JSON text; accepting
 * binary would mean a second decode path, and a second decode path on a security
 * boundary is a second place to get it wrong.
 *
 * @param {WebSocket} ws - The upgraded socket.
 * @param {SocketHooks} hooks - The daemon's half.
 * @param {(message: string) => void} warn - Report a failure without dying of it.
 */
export function adoptSocket(
  ws: WebSocket,
  hooks: SocketHooks,
  warn: (message: string) => void,
): void {
  const port: WsSessionPort = {
    send: (text: string) => ws.send(text),
    close: (code: number, reason: string) => ws.close(code, reason),
    bufferedAmount: () => ws.bufferedAmount,
  };
  const session: AcceptedSocket = hooks.accept(port);

  let awaitingPong: NodeJS.Timeout | null = null;
  const heartbeat = setInterval(() => {
    if (awaitingPong !== null) {
      return;
    }
    ws.ping();
    awaitingPong = setTimeout(() => ws.terminate(), PONG_TIMEOUT_MS);
    awaitingPong.unref();
  }, PING_MS);
  heartbeat.unref();

  /**
   * Stop the timers, whichever way the socket ended.
   */
  const stopTimers = (): void => {
    clearInterval(heartbeat);
    if (awaitingPong !== null) {
      clearTimeout(awaitingPong);
      awaitingPong = null;
    }
  };

  ws.on('pong', () => {
    if (awaitingPong !== null) {
      clearTimeout(awaitingPong);
      awaitingPong = null;
    }
  });

  ws.on('message', (data: unknown, isBinary: boolean) => {
    if (isBinary) {
      ws.close(CLOSE_MALFORMED, 'this protocol is text');
      return;
    }
    void session.message(String(data)).catch((err: unknown) => {
      warn(`live session failed: ${err instanceof Error ? err.message : String(err)}`);
      ws.close(CLOSE_MALFORMED, 'session error');
    });
  });

  ws.on('error', (err: Error) => {
    warn(`live socket error: ${err.message}`);
  });

  ws.on('close', () => {
    stopTimers();
    session.closed();
  });
}

/**
 * Attach the live wire to a bound server.
 *
 * The server is created with `noServer`, so nothing is upgraded until
 * {@link SocketHooks.check} has said yes. `handleProtocols` cannot be relied on
 * to refuse — returning false from it does not reject the handshake — so the
 * subprotocol is checked in the gate alongside `Host` and `Origin`, and this
 * only echoes the one the daemon speaks.
 *
 * Compression stays off: `permessage-deflate` on a control socket buys nothing
 * on loopback and costs memory per session and a compression oracle.
 *
 * @param {TlsServer} server - The bound server.
 * @param {SocketHooks} hooks - The daemon's half.
 * @param {(message: string) => void} warn - Report a failure without dying of it.
 * @returns {WebSocketServer} The attached server, for shutdown.
 */
export function attachLiveWire(
  server: TlsServer,
  hooks: SocketHooks,
  warn: (message: string) => void,
): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false,
    handleProtocols: () => LIVE_SUBPROTOCOL,
  });

  server.on('upgrade', (req, socket, head) => {
    const refusal = hooks.check({
      host: firstHeader(req.headers.host),
      origin: firstHeader(req.headers.origin),
      protocols: offeredProtocols(firstHeader(req.headers['sec-websocket-protocol'])),
    });
    if (refusal !== null) {
      refuseUpgrade(socket, refusal);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      adoptSocket(ws, hooks, warn);
    });
  });

  return wss;
}

/**
 * Bind a server, rejecting if it cannot take the address.
 *
 * @param {TlsServer} server - The server to bind.
 * @param {number} port - The port.
 * @param {string} host - The address.
 * @param {boolean} ipv6Only - Whether to refuse v4-mapped connections on it.
 * @returns {Promise<void>} Resolves once bound.
 */
export function bindServer(
  server: TlsServer,
  port: number,
  host: string,
  ipv6Only: boolean,
): Promise<void> {
  return new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen({ port, host, ipv6Only }, () => {
      server.removeListener('error', fail);
      // An `error` with no listener is a thrown exception in Node, so a socket
      // that fails *after* binding would take the whole daemon down. Report it
      // and keep serving: one broken connection is not a reason to drop every
      // other one, and a silent exit is the worst of the available answers.
      server.on('error', (err: Error) => {
        process.stderr.write(`pawd: socket error on ${host}:${port}: ${err.message}\n`);
      });
      done();
    });
  });
}

/**
 * Stop a server listening.
 *
 * @param {TlsServer} server - The server.
 * @returns {Promise<void>} Resolves once closed.
 */
export function closeServer(server: TlsServer): Promise<void> {
  return new Promise<void>((done, fail) => {
    server.close((err) => (err ? fail(err) : done()));
  });
}

/**
 * Bind the IPv6 loopback alongside the IPv4 one, on the same port.
 *
 * A failure here is reported and survived rather than thrown: the daemon is
 * already listening and reachable on `127.0.0.1`, and a machine with IPv6
 * disabled is a configuration, not a fault. What it must never do is stay quiet
 * about it, because the symptom — `https://localhost` failing while
 * `https://127.0.0.1` works — is otherwise unexplainable from the outside.
 *
 * @param {TlsServer} server - The second server.
 * @param {number} port - The port IPv4 bound.
 * @returns {Promise<boolean>} True when it is listening.
 */
export async function bindLoopbackV6(server: TlsServer, port: number): Promise<boolean> {
  try {
    await bindServer(server, port, LOOPBACK_V6, true);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `pawd: could not also listen on [${LOOPBACK_V6}]:${port} (${message}). ` +
        `https://127.0.0.1:${port}/ works; https://localhost:${port}/ may not.\n`,
    );
    return false;
  }
}

/**
 * Build the real runtime.
 *
 * The console page is required rather than defaulted. A default would have to
 * encode one on-disk layout, and PAW runs in two — a source checkout and a
 * built artifact — so any constant is wrong in one of them, silently, until
 * someone opens the console. Requiring it makes the omission a compile error
 * and leaves the choice with the shell, which is the only thing that knows how
 * it was started. See {@link consolePage}.
 *
 * @param {string} pagePath - Path to the console page.
 * @returns {DaemonRuntime} The node-backed runtime.
 */
export function nodeRuntime(pagePath: string): DaemonRuntime {
  return {
    readFile: (path: string) => readFile(resolve(path), 'utf8'),

    importModule: (path: string, version: number): Promise<unknown> =>
      import(`${pathToFileURL(resolve(path)).href}?v=${version}`) as Promise<unknown>,

    modifiedAt: async (path: string): Promise<number> => (await stat(resolve(path))).mtimeMs,

    listProcesses: async (): Promise<HostProcess[]> =>
      collectSubtree((await psList()).map(toHostProcess), process.pid),

    listFiles: (root: string): Promise<FileEntry[]> => walkFiles(resolve(root)),

    readHost: () => readHostInfo(process, os),

    now: () => new Date().toISOString(),

    clock: () => Date.now(),

    warn: report,

    randomToken: () => randomBytes(TOKEN_BYTES).toString('base64url'),

    identity: () => nodeServerIdentity(process.env, process.platform, new Date()),

    readPage: async (): Promise<string> => {
      try {
        return await readFile(pagePath, 'utf8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
        process.stderr.write(
          `pawd: ${pagePath} is missing — serving the bootstrap page. Build @paw/gui for the console.\n`,
        );
        return BOOTSTRAP;
      }
    },

    listen: async (handler, hooks, port, host, tls): Promise<ServerHandle> => {
      const v4 = createConsoleServer(tls, handler, host);
      const v4Wire = attachLiveWire(v4, hooks, report);
      await bindServer(v4, port, host, false);
      const bound = boundPort(v4.address(), port);

      const v6 = createConsoleServer(tls, handler, host);
      const v6Wire = attachLiveWire(v6, hooks, report);
      const v6Listening = await bindLoopbackV6(v6, bound);

      return {
        port: bound,
        close: async (): Promise<void> => {
          v4Wire.close();
          v6Wire.close();
          await closeServer(v4);
          if (v6Listening) {
            await closeServer(v6);
          }
        },
      };
    },

    schedule: (fn, ms) => {
      const timer = setInterval(fn, ms);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
