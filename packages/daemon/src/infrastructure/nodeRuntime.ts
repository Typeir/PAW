/**
 * PAW Daemon Node Runtime
 *
 * @fileoverview Real effects behind {@link DaemonRuntime}: filesystem, dynamic
 * import, live host process table via `ps-list`, `process`/`os`, and loopback
 * TLS server (in `./http`). Adapter from daemon to host primitives; decisions
 * are made in `serve`. Integration tests cover it: bind real port, fetch real
 * state, no exclusion.
 *
 * Console is `@paw/gui`'s `dist/live.html` — React console with no snapshot
 * injected, so it fetches `/api/state` and polls. When the GUI is not built,
 * a dependency-free bootstrap page renders the state in the browser.
 *
 * @module @paw/daemon/infrastructure/nodeRuntime
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { randomBytes } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import psList from 'ps-list';
import type { HostProcess } from '@paw/core';
import { readHostInfo } from '../domain/host.js';
import { IGNORED_DIRS, type FileEntry } from '../domain/tree.js';
import type { DaemonRuntime, ServerHandle } from '../application/daemonContracts.js';
import { nodeServerIdentity } from './nodeIdentity.js';
import { collectSubtree } from './process.js';
import { TOKEN_BYTES } from './security.js';
import {
  attachLiveWire,
  bindLoopbackV6,
  bindServer,
  closeServer,
  createConsoleServer,
} from './http/consoleServer.js';
import { boundPort, toHostProcess } from './http/httpMessage.js';

/**
 * Report line to operator. Daemon-level failures are only written here, so
 * every source uses the same report format.
 *
 * @param {string} message - What happened.
 */
export function report(message: string): void {
  process.stderr.write(`pawd: ${message}\n`);
}

/**
 * No-framework page that fetch `/api/state` and show real host, owned
 * processes, and doctor — served when `@paw/gui` no built.
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
 * Walk directory tree into a flat listing of file tree entries. Directories in
 * IGNORED_DIRS are skipped, so large excluded trees (e.g. `node_modules`) are
 * not read into memory. Paths are returned relative and always use `/`.
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
 * Build the node-backed runtime. `pagePath` is required, no default; the
 * caller supplies the console page path because PAW runs both from a source
 * checkout and from a built artifact.
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
