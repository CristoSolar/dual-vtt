import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { startServer, type RunningServer } from '@daggerheart/server/server';
import { app, BrowserWindow, clipboard, dialog, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';

import { findPort, isAppUrl, isExternalWebUrl, lanAddresses } from './net.js';

/**
 * Dual VTT as a desktop app: the same server `pnpm host` runs, in this process,
 * serving the prebuilt web app, with its data under the OS's per-user app data
 * directory, and one window onto it. Players join over the LAN (the server listens
 * on every interface) or through the in-app tunnel.
 */

const PREFERRED_PORT = 4000;
/** Every interface, so players on the same network can open the LAN link. */
const HOST = '0.0.0.0';
const PROJECT_URL = 'https://cristosolar.github.io/dual-vtt/';
/** How long quitting waits for the final snapshot before giving up on it. */
const SHUTDOWN_TIMEOUT_MS = 8_000;

const STRINGS = {
  es: {
    view: 'Ver',
    help: 'Ayuda',
    edit: 'Editar',
    openData: 'Abrir carpeta de datos',
    project: 'Página del proyecto',
    copyLan: 'Copiar enlace LAN',
    lanTitle: 'Enlace para la red local',
    lanCopied: 'Copiado al portapapeles. Tus jugadores en la misma red pueden abrirlo en su navegador:',
    lanNone: 'No se encontró ninguna red local. Usa «Generar enlace para jugadores» en Mis campañas para jugar por internet.',
    lanFirewall: 'Si no conecta, permite Dual VTT en el cortafuegos del sistema.',
    startFailed: 'Dual VTT no pudo iniciar su servidor',
  },
  en: {
    view: 'View',
    help: 'Help',
    edit: 'Edit',
    openData: 'Open data folder',
    project: 'Project page',
    copyLan: 'Copy LAN link',
    lanTitle: 'Local network link',
    lanCopied: 'Copied to the clipboard. Players on the same network can open it in their browser:',
    lanNone: 'No local network found. Use "Generate link for players" in My campaigns to play over the internet.',
    lanFirewall: 'If it does not connect, allow Dual VTT through the system firewall.',
      startFailed: 'Dual VTT could not start its server',
    },
};
/** Menu and dialog text in the OS language (Electron knows it only once ready). */
const text = (): (typeof STRINGS)['en'] =>
  app.isReady() && app.getLocale().toLowerCase().startsWith('es') ? STRINGS.es : STRINGS.en;

let server: RunningServer | null = null;
let window: BrowserWindow | null = null;

// One app, one server, one set of snapshots: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  void app.whenReady().then(start).catch((error: unknown) => {
    console.error(error);
    dialog.showErrorBox(text().startFailed, error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
}

/** Kept under userData, which updates and reinstalls leave alone. */
const dataDir = (): string => join(app.getPath('userData'), 'data');

async function start(): Promise<void> {
  const data = dataDir();
  // Packaged: electron-builder copies the web build to resources/web. From source
  // (`pnpm -F @daggerheart/desktop start`): the bundle sits in apps/desktop/out.
  const webDistDir = app.isPackaged ? join(process.resourcesPath, 'web') : join(__dirname, '..', '..', 'web', 'dist');
  const port = await findPort(PREFERRED_PORT, HOST);
  server = await startServer({
    port,
    host: HOST,
    campaignsSnapshotPath: join(data, 'campaigns.json'),
    campaignsSnapshotIntervalMs: 15_000,
    usersSnapshotPath: join(data, 'users.json'),
    charactersSnapshotPath: join(data, 'characters.json'),
    uploadDir: join(data, 'uploads'),
    webDistDir,
    // No gm/gm here: the first window asks its owner to create the GM.
    bootGm: null,
    firstRunSetup: true,
    // Same origin only; the window and LAN players both load the app from this server.
    allowedOrigins: [],
    // The npm package's own bin path is inside the read-only app archive.
    cloudflaredBin: join(app.getPath('userData'), 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
  });
  console.log(`Dual VTT listening on http://localhost:${server.port} (data: ${data})`);

  lockDownSessions();
  Menu.setApplicationMenu(buildMenu(server.port));
  openWindow(server.port);
}

function openWindow(port: number): void {
  const origin = `http://localhost:${port}`;
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Dual VTT',
    backgroundColor: '#0b0812',
    show: false,
    // Linux shows this in the taskbar; Windows and macOS take the packaged icon.
    ...(process.platform === 'linux' ? { icon: join(__dirname, '..', 'resources', 'icon.png') } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    window = null;
  });

  const contents = window.webContents;
  // Links out of the app (licence, daggerheart.com) open in the system browser;
  // the window itself never leaves the local server.
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url) && !isAppUrl(url, origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const keepInApp = (event: Electron.Event, url: string): void => {
    if (isAppUrl(url, origin)) return;
    event.preventDefault();
    if (isExternalWebUrl(url)) void shell.openExternal(url);
  };
  contents.on('will-navigate', keepInApp);
  contents.on('will-redirect', keepInApp);

  void window.loadURL(origin);
}

/** Only the permissions the app uses: copying the player link, and fullscreen. */
function lockDownSessions(): void {
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(allowed.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
}

function showLanLink(port: number): void {
  const links = lanAddresses(networkInterfaces()).map((address) => `http://${address}:${port}`);
  const first = links[0];
  if (first !== undefined) clipboard.writeText(first);
  const options = {
    type: 'info' as const,
    title: text().lanTitle,
    message: first === undefined ? text().lanNone : `${text().lanCopied}\n\n${links.join('\n')}\n\n${text().lanFirewall}`,
  };
  if (window === null) void dialog.showMessageBox(options);
  else void dialog.showMessageBox(window, options);
}

function buildMenu(port: number): Menu {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    // Without an Edit menu macOS has no copy/paste shortcuts in text fields.
    ...(mac ? [{ role: 'editMenu' as const, label: text().edit }] : []),
    {
      label: text().view,
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: text().help,
      role: 'help',
      submenu: [
        { label: text().copyLan, click: () => showLanLink(port) },
        { label: text().openData, click: () => void shell.openPath(dataDir()) },
        { type: 'separator' },
        { label: text().project, click: () => void shell.openExternal(PROJECT_URL) },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// The server belongs to the window: closing it ends the session on every platform,
// macOS included, so a table is never left running unseen.
app.on('window-all-closed', () => app.quit());

/** Quitting waits for the server's final snapshot (bounded, so a stuck socket cannot hang it). */
let closed = false;
let closing = false;
app.on('before-quit', (event) => {
  if (server === null || closed) return;
  event.preventDefault();
  if (closing) return;
  closing = true;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS));
  void Promise.race([server.close(), timeout])
    .catch((error: unknown) => console.error('shutdown failed', error))
    .finally(() => {
      closed = true;
      app.quit();
    });
});

// A terminal Ctrl-C or a session logout goes through the same snapshot path.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
