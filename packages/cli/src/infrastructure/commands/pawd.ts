/**
 * PAW CLI — resident daemon lifecycle
 *
 * @fileoverview Spawning and running pawd: `spawnPawd` (created off the host
 * editor's job via WMI on Windows so the spawning hook never hangs), the real
 * `autostartSeams` the hook client hands `ensureDaemon`, and the `__pawd` entry
 * `runPawd` that brings enforcement up for a root and stays resident. All
 * process-shell; the pure autostart decision tree lives in `autostart.ts`.
 *
 * @module @paw/cli/infrastructure/commands/pawd
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { spawn } from 'node:child_process';
import { closeSync, openSync, statSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { type AutostartSeams } from '../../application/autostart.js';
import { startEnforcement } from '../../application/pawdStart.js';

/**
 * Spawn the resident daemon so it does not stay inside the host editor's job.
 *
 * On Windows a hook's detached child is still a member of the editor's job
 * object, so the editor waits on the never-exiting daemon and the spawning hook
 * hangs (the ~18-minute cold-hook hang). `windowsHide` did not cut the tether
 * because the tether is the job, not the console, and Node's `detached` sets
 * `DETACHED_PROCESS`, not `CREATE_BREAKAWAY_FROM_JOB` (which it will not expose).
 * Creating pawd through WMI `Win32_Process.Create` makes it a child of the WMI
 * host instead — outside the editor's job and its pseudo-console — via a
 * short-lived PowerShell launcher that itself exits at once. On posix there is
 * no such tether: a plain detached, unref'd child already outlives the hook, so
 * that path is kept unchanged and never touches WMI.
 *
 * @param {string} root - The project root pawd will serve.
 * @returns {void | Promise<void>} Posix is fire-and-forget; Windows resolves once
 * the short-lived launcher has created pawd, after which the caller polls the socket.
 */
export function spawnPawd(root: string): void | Promise<void> {
  const argv = [...process.execArgv, process.argv[1], '__pawd', root];
  if (process.platform !== 'win32') {
    const child = spawn(process.execPath, argv, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return;
  }
  const commandLine = [process.execPath, ...argv].map((part) => `"${part}"`).join(' ');
  const quote = (value: string): string => value.replace(/'/g, "''");
  // A WMI-created process gets its own visible console by default; a startup
  // record with ShowWindow = SW_HIDE (0) suppresses it so no empty window flashes.
  // (CreateFlags = CREATE_NO_WINDOW is rejected by Win32_Process.Create as invalid.)
  const script =
    `$s = New-CimInstance -ClientOnly -ClassName Win32_ProcessStartup -Namespace root/cimv2 ` +
    `-Property @{ ShowWindow = [uint16]0 }; ` +
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ ` +
    `CommandLine = '${quote(commandLine)}'; CurrentDirectory = '${quote(root)}'; ` +
    `ProcessStartupInformation = $s } | Out-Null`;
  // Pass the script base64-encoded (PowerShell wants UTF-16LE): Node's Windows
  // argument escaping mangles the embedded quotes of a plain -Command string,
  // which silently produced a malformed WMI call that spawned nothing.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  // Await the launcher rather than detach it: it must finish the WMI create
  // before the hook's process.exit(), which would otherwise tear the cold-
  // starting launcher down mid-flight and spawn nothing. The launcher exits at
  // once; pawd, created by the WMI host, is off the editor's job and lives on.
  return new Promise<void>((resolve) => {
    const launcher = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { stdio: 'ignore', windowsHide: true },
    );
    launcher.on('error', () => resolve());
    launcher.on('exit', () => resolve());
  });
}

/**
 * The real autostart effects: probe by opening a connection, take the lock by
 * exclusive create, spawn pawd off the editor's job via {@link spawnPawd}, and
 * sleep with a timer.
 *
 * @param {string} root - The project root pawd would serve.
 * @returns {AutostartSeams} The effects for `ensureDaemon`.
 */
export function autostartSeams(root: string): AutostartSeams {
  return {
    probe: (sock) =>
      new Promise((res) => {
        const socket = connect(sock);
        const settle = (up: boolean): void => {
          socket.destroy();
          res(up);
        };
        socket.once('connect', () => settle(true));
        socket.once('error', () => settle(false));
        setTimeout(() => settle(false), 500).unref();
      }),
    lockAgeMs: (lp) => {
      try {
        return Date.now() - statSync(lp).mtimeMs;
      } catch {
        return null;
      }
    },
    acquire: (lp) => {
      try {
        closeSync(openSync(lp, 'wx'));
        return true;
      } catch {
        return false;
      }
    },
    release: (lp) => {
      try {
        unlinkSync(lp);
      } catch {
        /* already gone */
      }
    },
    spawn: () => spawnPawd(root),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/**
 * The `__pawd` entry: bring enforcement up for a root and stay resident. This is
 * what autostart spawns; it never returns until the process is killed.
 *
 * @param {string} root - The project root to serve.
 * @returns {Promise<never>} Never resolves.
 */
export async function runPawd(root: string): Promise<never> {
  await startEnforcement(root, {
    idle: { ms: 3_600_000, onIdle: () => process.exit(0) },
    control: { pid: process.pid, now: () => Date.now(), onStop: () => process.exit(0) },
  });
  return new Promise<never>(() => undefined);
}
