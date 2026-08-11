/**
 * PAW CLI — resident daemon lifecycle
 *
 * @fileoverview Spawn pawd run pawd: `spawnPawd` (create off host editor's
 * job via WMI on Windows), `autostartSeams` hook client hand `ensureDaemon`,
 * and `__pawd` entry `runPawd` bring enforcement up for root and stay
 * resident. All process-shell; pure autostart decision tree live in
 * `autostart.ts`.
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
 * Spawn resident daemon outside host editor's job.
 *
 * On Windows a detached child stays a member of the editor's job object;
 * `windowsHide` does not break that membership: Node's `detached` sets
 * `DETACHED_PROCESS` and exposes no `CREATE_BREAKAWAY_FROM_JOB`.
 * Create pawd through WMI `Win32_Process.Create`, via short-lived PowerShell
 * launcher that exit at once, make it child of WMI host, outside the
 * editor's job and its pseudo-console. On posix plain detached, unref'd child
 * outlive the hook; that path never touch WMI.
 *
 * @param {string} root - Project root pawd serve.
 * @returns {void | Promise<void>} Posix fire-and-forget; Windows resolve once
 * short-lived launcher create pawd, after which caller poll the socket.
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
  // WMI-created process get own visible console by default; startup
  // record with ShowWindow = SW_HIDE (0) suppress it so no empty window flash.
  // (CreateFlags = CREATE_NO_WINDOW rejected by Win32_Process.Create as invalid.)
  const script =
    `$s = New-CimInstance -ClientOnly -ClassName Win32_ProcessStartup -Namespace root/cimv2 ` +
    `-Property @{ ShowWindow = [uint16]0 }; ` +
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ ` +
    `CommandLine = '${quote(commandLine)}'; CurrentDirectory = '${quote(root)}'; ` +
    `ProcessStartupInformation = $s } | Out-Null`;
  // Pass script base64-encoded (PowerShell want UTF-16LE): Node's Windows
  // argument escaping mangle embedded quotes of plain -Command string,
  // which silently produce malformed WMI call that spawn nothing.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  // Await the launcher: it must finish the WMI create
  // before hook's process.exit(); otherwise process.exit() terminates the
  // still-starting launcher before it spawns pawd. Launcher exit at
  // once; pawd, created by WMI host, off editor's job and live on.
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
 * Autostart effects: probe by opening connection, take lock by
 * exclusive create, spawn pawd off editor's job via {@link spawnPawd}, and
 * sleep with timer.
 *
 * @param {string} root - Project root pawd would serve.
 * @returns {AutostartSeams} Effects for `ensureDaemon`.
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
        /* already gone. */
      }
    },
    spawn: () => spawnPawd(root),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/**
 * `__pawd` entry: bring enforcement up for root and stay resident.
 * Autostart spawn it; it never return until process killed.
 *
 * @param {string} root - Project root to serve.
 * @returns {Promise<never>} Never resolve.
 */
export async function runPawd(root: string): Promise<never> {
  await startEnforcement(root, {
    idle: { ms: 3_600_000, onIdle: () => process.exit(0) },
    control: { pid: process.pid, now: () => Date.now(), onStop: () => process.exit(0) },
  });
  return new Promise<never>(() => undefined);
}
