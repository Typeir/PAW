/**
 * PAW Electron Main Process
 *
 * @fileoverview The desktop shell for the PAW console, and by design a shell
 * only. It starts `pawd` inside this very process — the same `runDaemon` the CLI
 * calls, on the same node runtime — and opens one hardened
 * {@link BrowserWindow} on the loopback URL that daemon bound. The window
 * therefore shows live data: the host facts, the owned process subtree, and the
 * plan's doctor, re-read on every poll, rather than a page frozen at build time.
 *
 * The window is **frameless**, and the console's own titlebar is therefore the
 * real one: it drags the window, and its three lights minimise, maximise, and
 * close it over a single IPC channel that accepts those three named actions and
 * nothing else. A browser tab gets no such bridge, so the same console draws no
 * window chrome there — the costume of a fake window belongs to neither shell.
 *
 * The security posture is otherwise unchanged and is stated in one place below:
 * context isolation on, node integration off, sandbox on, a strict CSP stamped
 * on every response whose only relaxation is `connect-src` for the daemon's own
 * origin, navigation away denied, and that one narrow bridge as the window's
 * single channel to the main process. The daemon serves TLS, and this shell
 * **pins** its certificate rather than trusting a store: the only certificate it
 * will accept is the one the daemon in this same process is holding, so the
 * desktop app needs no trust-store change and cannot be redirected by one. Nothing here is domain logic —
 * per decision doc 11 the GUI is a presenter over the daemon, and Electron is a
 * shell around that GUI, not a twin that owns a second brain. A `--capture`
 * launch renders once to a PNG for regression, then quits.
 *
 * @module @paw/electron/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  chromiumFingerprint,
  createNodeRecentRoutes,
  identityNotice,
  nodeRuntime,
  pawHome,
  runDaemon,
  type DaemonHandle,
} from '@paw/daemon';

/**
 * Whether this launch is a headless regression capture rather than an
 * interactive session.
 */
const IS_CAPTURE = process.argv.includes('--capture') || process.env.PAW_CAPTURE === '1';

/**
 * The hardened `webPreferences` shared by the interactive and capture windows.
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
 * The Content-Security-Policy stamped onto every response. `default-src 'none'`
 * denies everything, then only the console's own needs are re-granted: the
 * inline bundle's script and style, `data:` images and fonts, and `connect-src`
 * for the daemon's origin alone — that single grant is what lets the page poll
 * `/api/state`, and it reaches nothing else on the network.
 *
 * @param {string} origin - The daemon's origin, e.g. `https://127.0.0.1:8971`.
 * @returns {string} The policy.
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
 * Read what repository this shell should serve. Nothing is required: with no
 * arguments it serves the directory it was launched from, discovering that
 * repo's config and every plan in it, exactly as `paw ui` does. A plan may be
 * named to open on.
 *
 * @param {string[]} argv - The process argv.
 * @returns {{ root: string; configPath?: string; planPath?: string }} The launch options.
 */
export function readLaunchArgs(argv: string[]): {
  root: string;
  configPath?: string;
  planPath?: string;
} {
  const flag = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
  };
  const [planPath] = argv
    .slice(2)
    .filter((a) => !a.startsWith('-') && !a.endsWith('.cjs'));
  return { root: flag('root') ?? '.', configPath: flag('config'), planPath };
}

/**
 * Stamp the policy onto every response for the default session. Registered
 * before any load, so the first document is already governed.
 *
 * @param {string} origin - The daemon's origin.
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
 * Trust exactly one certificate: the one the daemon in this very process just
 * loaded from disk. Everything else is refused outright.
 *
 * This is a **pin**, and it is a stronger claim than trusting the CA would be —
 * the shell is not asking "did something on this machine vouch for this name?",
 * it is asking "is this the certificate my own daemon is holding?". The operator
 * therefore never has to add the CA to a trust store for the desktop app to
 * work, and adding it would not widen what this window will talk to.
 *
 * The verdicts are Chromium's: `0` accepts, `-2` rejects, and there is no branch
 * that returns `-3` (defer to Chromium) or that treats a verification failure as
 * a prompt. A shell that can be talked out of its pin is not pinned.
 *
 * @param {string} fingerprint - The served certificate's digest, as PAW records it.
 * @param {string} host - The only hostname this shell may reach.
 */
function pinDaemonCertificate(fingerprint: string, host: string): void {
  const expected = chromiumFingerprint(fingerprint);
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === host && request.certificate.fingerprint === expected ? 0 : -2);
  });
}

/**
 * Serve the three window actions the console's titlebar asks for, and nothing
 * else. The window is frameless — the console draws its titlebar, so these are
 * the buttons on it. Any other action is refused rather than interpreted, and
 * the request only ever moves the window it came from.
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
 * Deny every navigation and every new-window request, pinning the shell to the
 * daemon's page. Defence in depth behind the CSP.
 *
 * @param {BrowserWindow} win - The window to guard.
 */
function lockToDaemon(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
}

/**
 * Create the one hardened window on the daemon's URL.
 *
 * @param {string} url - The daemon's console URL.
 * @returns {BrowserWindow} The created window.
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
    webPreferences: { ...SECURE_WEB_PREFERENCES },
  });
  lockToDaemon(win);
  win.once('ready-to-show', () => win.show());
  void win.loadURL(url);
  return win;
}

/**
 * How long a capture waits after the page loads. `loadURL` resolves when the
 * document is loaded, which is before the console's first fetches of
 * `/api/state` and `/api/tree` have answered — capturing at that instant golden-
 * images a loading spinner rather than the console.
 */
const SETTLE_MS = 1200;

/**
 * Wait, so a capture photographs a settled page.
 *
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>} Resolves when the time has passed.
 */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render the console once in a hidden window, write a PNG of it, and return —
 * the regression-screenshot path.
 *
 * @param {string} url - The daemon's console URL.
 */
async function capture(url: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
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
 * The console page the daemon serves, resolved from this bundle's own location
 * (`packages/electron/dist`) rather than from the daemon's, which a CommonJS
 * bundle cannot know.
 */
const GUI_PAGE = join(__dirname, '..', '..', 'gui', 'dist', 'live.html');

/**
 * The daemon this shell runs, kept so it can be stopped with the app.
 */
let daemon: DaemonHandle | null = null;

/**
 * Start the daemon, then the window.
 */
async function start(): Promise<void> {
  daemon = await runDaemon(
    {
      ...readLaunchArgs(process.argv),
      scopeCeiling: homedir(),
      recent: createNodeRecentRoutes(pawHome(process.platform, process.env)),
    },
    nodeRuntime(GUI_PAGE),
  );
  process.stdout.write(
    `pawd (in-process) on ${daemon.url} · repo ${daemon.root} · ${daemon.plans.length} plan(s)\n` +
      identityNotice(daemon.identity, new Date())
        .map((line) => `  ${line}\n`)
        .join(''),
  );
  pinDaemonCertificate(daemon.identity.meta.leafFingerprint, '127.0.0.1');
  installCsp(`https://127.0.0.1:${daemon.port}`);
  installWindowControls();

  // The console reads its credential from the URL fragment and immediately
  // replaces it out of history — the same path a browser takes from the printed
  // URL. Giving the desktop shell a private channel instead would mean a second
  // authentication path to keep correct, and this one is already tested.
  const url = `${daemon.url}#t=${daemon.token}`;

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
