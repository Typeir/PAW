/**
 * PAW Electron Main Process
 *
 * @fileoverview Desktop shell for PAW console. Two launch modes. Default:
 * start `pawd` inside this same process — same `runDaemon` CLI call, same node
 * runtime — and open one hardened {@link BrowserWindow} on loopback URL daemon
 * bound. Viewer (`--url= --fingerprint=`): open the window on an external
 * pawd's console URL instead — `paw ui --open` launches this mode against the
 * daemon it just started, so release approvals stay on that daemon's terminal.
 * The fingerprint is that daemon's leaf certificate; the window pins it exactly
 * as it pins an in-process daemon's. Window re-reads live data every poll:
 * host facts, owned process subtree, plan doctor; content from the daemon
 * snapshot.
 *
 * Window **frameless**. Console renders its own titlebar; three buttons
 * minimise, maximise, close over single IPC channel. Channel accepts only those
 * three actions. Browser tab has no IPC bridge, so the same console draws no
 * window chrome there.
 *
 * Security posture otherwise unchanged, stated in one place below: context
 * isolation on, node integration off, sandbox on, strict CSP applied to every
 * response. Only relaxation `connect-src` for daemon's own origin. Navigation
 * away denied. The IPC channel is the window's only channel to main process.
 * Daemon serve TLS, shell **pins** its certificate: accept only certificate
 * daemon in this same process hold; no trust-store lookup. Desktop app need no
 * trust-store change, cannot be redirected by one. No domain logic here — per
 * decision doc 11 GUI presenter over daemon, Electron shell around that GUI.
 * `--capture` launch render once to PNG for regression, then quit.
 *
 * @module @paw/electron/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  chromiumFingerprint,
  createNodeLogSink,
  createNodeRecentRoutes,
  identityNotice,
  listProviders,
  nodeRuntime,
  pawHome,
  recordConsoleEndpoint,
  runDaemon,
  type DaemonHandle,
} from '@paw/daemon';

/**
 * This launch is a headless regression capture.
 */
const IS_CAPTURE = process.argv.includes('--capture') || process.env.PAW_CAPTURE === '1';

/**
 * Hardened `webPreferences` shared by interactive and capture windows.
 */
const SECURE_WEB_PREFERENCES = {
  preload: join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
} as const;

/**
 * Content-Security-Policy applied to every response. `default-src 'none'`
 * deny everything, then re-grant only console's own needs: inline bundle's
 * script and style, `data:` images and fonts, and `connect-src` for daemon's
 * origin alone — that single grant lets page poll `/api/state`, reach nothing
 * else on network.
 *
 * @param {string} origin - Daemon's origin, e.g. `https://127.0.0.1:8971`.
 * @returns {string} Policy.
 */
function cspFor(origin: string): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${origin} ${origin.replace('https://', 'wss://')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Read repository this shell launches. No arguments required; resolves the
 * directory launched from, discovers that repo's config and every plan in it,
 * as `paw ui` do. Plan may be named to open on. `--url=` with `--fingerprint=`
 * selects viewer mode: no in-process daemon, window opens on that URL and pins
 * that certificate.
 *
 * @param {string[]} argv - Process argv.
 * @returns {{ root: string; configPath?: string; planPath?: string; url?: string; fingerprint?: string }} Launch options.
 */
export function readLaunchArgs(argv: string[]): {
  root: string;
  configPath?: string;
  planPath?: string;
  url?: string;
  fingerprint?: string;
} {
  const flag = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
  };
  const [planPath] = argv
    .slice(2)
    .filter((a) => !a.startsWith('-') && !a.endsWith('.cjs'));
  return {
    root: resolve(flag('root') ?? '.'),
    configPath: flag('config'),
    planPath,
    url: flag('url'),
    fingerprint: flag('fingerprint'),
  };
}

/**
 * Apply policy to every response for default session. Register before any
 * load, so first document already governed.
 *
 * @param {string} origin - Daemon's origin.
 */
function installCsp(origin: string): void {
  const csp = cspFor(origin);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    });
  });
}

/**
 * Trust exactly one certificate: one daemon in this very process just loaded
 * from disk. Refuse everything else outright.
 *
 * This is a **pin**: the shell compares the presented certificate against the
 * fingerprint of the daemon it launched. No trust-store lookup runs, and adding
 * a CA to the trust store does not widen what the window accepts.
 *
 * Verdicts match Chromium's: `0` accept, `-2` reject. No branch returns `-3`
 * (defer to Chromium) nor turns verification failure into a prompt.
 *
 * @param {string} fingerprint - Served certificate's digest, as PAW record it.
 * @param {string} host - Only hostname this shell may reach.
 */
function pinDaemonCertificate(fingerprint: string, host: string): void {
  const expected = chromiumFingerprint(fingerprint);
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === host && request.certificate.fingerprint === expected ? 0 : -2);
  });
}

/**
 * Serve three window actions from the console titlebar. Window is frameless so
 * the console draws its titlebar and these are its buttons. Any other action
 * throws. Requests act only on the window that sent them.
 */
function installWindowControls(): void {
  ipcMain.handle('paw:window', (event, action: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === null) {
      return;
    }
    if (action === 'minimize') {
      win.minimize();
      return;
    }
    if (action === 'maximize') {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return;
    }
    if (action === 'close') {
      win.close();
      return;
    }
    throw new Error(`unknown window action: ${String(action)}`);
  });
}

/**
 * Deny every navigation and every new-window request, keeping the shell on the
 * daemon page. Second line of defense behind CSP.
 *
 * @param {BrowserWindow} win - Window to guard.
 */
function lockToDaemon(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
}

/**
 * Create one hardened window on daemon's URL.
 *
 * @param {string} url - Daemon's console URL.
 * @returns {BrowserWindow} Created window.
 */
function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0e13',
    icon: ICON,
    webPreferences: { ...SECURE_WEB_PREFERENCES },
  });
  lockToDaemon(win);
  win.once('ready-to-show', () => win.show());
  void win.loadURL(url);
  return win;
}

/**
 * How long capture waits after page load. `loadURL` resolves when the document
 * loads, before the console's first fetches of `/api/state` and `/api/tree`
 * answer; capturing at that instant captures the loading spinner.
 */
const SETTLE_MS = 1200;

/**
 * Wait after page load so the console fetches of `/api/state` and
 * `/api/tree` have answered before capture.
 *
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>} Resolve when time pass.
 */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render console once in hidden window, write PNG of it, return — the
 * regression-screenshot path.
 *
 * @param {string} url - Daemon's console URL.
 */
async function capture(url: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    icon: ICON,
    webPreferences: { ...SECURE_WEB_PREFERENCES },
  });
  lockToDaemon(win);
  await win.loadURL(url);
  await settle(SETTLE_MS);
  const image = await win.webContents.capturePage();
  const out = join(__dirname, 'capture.png');
  await writeFile(out, image.toPNG());
  process.stdout.write(`captured → ${out}\n`);
  win.destroy();
}

/**
 * Console page daemon serve, resolved from this bundle's own location
 * (`packages/electron/dist`). The daemon's own location is gone after the
 * CommonJS bundling.
 */
const GUI_PAGE = join(__dirname, '..', '..', 'gui', 'dist', 'live.html');

/**
 * Window and taskbar icon: the console's paw mark, rendered to `.ico` by
 * `npm run build:icons`. The packaged exe's own resource icon is a separate
 * install-time concern (rcedit), not set here.
 */
const ICON = join(__dirname, '..', 'assets', 'paw.ico');

/**
 * Daemon this shell run, kept so stop it with app.
 */
let daemon: DaemonHandle | null = null;

/**
 * Pin, apply CSP, and open the window (or capture) on a console URL. The tail
 * both launch modes share once a daemon URL and its certificate are known.
 *
 * @param {string} url - Console URL, credential fragment included.
 * @param {string} fingerprint - That daemon's leaf certificate fingerprint.
 * @returns {Promise<void>} Resolve once the window (or capture) is up.
 */
async function openOn(url: string, fingerprint: string): Promise<void> {
  pinDaemonCertificate(fingerprint, new URL(url).hostname);
  installCsp(new URL(url).origin);
  installWindowControls();
  if (IS_CAPTURE) {
    await capture(url);
    app.quit();
    return;
  }
  createWindow(url);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(url);
    }
  });
}

/**
 * Start daemon — or attach to an external one in viewer mode — then window.
 */
async function start(): Promise<void> {
  const launch = readLaunchArgs(process.argv);
  if (launch.url !== undefined) {
    if (launch.fingerprint === undefined) {
      throw new Error('--url needs --fingerprint of that daemon to pin');
    }
    process.stdout.write(`viewer on ${new URL(launch.url).origin} · external pawd\n`);
    await openOn(launch.url, launch.fingerprint);
    return;
  }
  daemon = await runDaemon(
    {
      ...launch,
      scopeCeiling: homedir(),
      recent: createNodeRecentRoutes(pawHome(process.platform, process.env)),
      logSink: createNodeLogSink(join(launch.root, '.paw', 'daemon.log')),
      providers: () => listProviders(launch.root),
    },
    nodeRuntime(GUI_PAGE),
  );
  process.stdout.write(
    `pawd (in-process) on ${daemon.url} · repo ${daemon.root} · ${daemon.plans.length} plan(s)\n` +
      identityNotice(daemon.identity, new Date())
        .map((line) => `  ${line}\n`)
        .join(''),
  );
  recordConsoleEndpoint(daemon.root, {
    url: daemon.url,
    token: daemon.token,
    fingerprint: daemon.identity.meta.leafFingerprint,
    pid: process.pid,
  });

  // Console reads its credential from the URL fragment, which is replaced out
  // of history — the same path a browser takes from a printed URL.
  await openOn(`${daemon.url}#t=${daemon.token}`, daemon.identity.meta.leafFingerprint);
}

void app.whenReady().then(() =>
  start().catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    app.exit(1);
  }),
);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  void daemon?.close();
});
