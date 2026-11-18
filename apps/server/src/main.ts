import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Server } from 'socket.io';

import { handleAuth } from './auth-http.js';
import { CampaignStore } from './campaigns.js';
import { handleCampaigns } from './campaigns-http.js';
import { readCampaignsSnapshot, writeCampaignsSnapshot } from './campaigns-snapshot.js';
import { CharacterStore } from './characters.js';
import { handleCharacters } from './characters-http.js';
import { readCharactersSnapshot, writeCharactersSnapshot } from './characters-snapshot.js';
import { broadcastPatches, registerGateway } from './gateway.js';
import { adoptRoomCharacters, serializeLibrary, type Patches } from './library.js';
import { SessionStore } from './sessions.js';
import { handleStatic } from './static.js';
import { handleTunnel } from './tunnel-http.js';
import { TunnelManager } from './tunnel.js';
import { handleUploads } from './uploads.js';
import { UserStore } from './users.js';
import { readUsersSnapshot, writeUsersSnapshot } from './users-snapshot.js';

const PORT = Number(process.env.PORT ?? 4000);
const CAMPAIGNS_SNAPSHOT_PATH = process.env.CAMPAIGNS_SNAPSHOT_PATH ?? '.data/campaigns.json';
const CAMPAIGNS_SNAPSHOT_INTERVAL_MS = Number(process.env.CAMPAIGNS_SNAPSHOT_INTERVAL_MS ?? 15_000);
/** Map images live beside the campaign snapshots. */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '.data/uploads';
/** The web app's production build. Absent in `pnpm dev` — Vite serves the app
 * itself there. Present when run via `pnpm host` (see host.ts). */
const WEB_DIST_DIR = process.env.WEB_DIST_DIR ?? '../web/dist';
const USERS_SNAPSHOT_PATH = process.env.USERS_SNAPSHOT_PATH ?? '.data/users.json';
/** Every account's character library. */
const CHARACTERS_SNAPSHOT_PATH = process.env.CHARACTERS_SNAPSHOT_PATH ?? '.data/characters.json';
/** The first GM account, created on boot if no account by this name exists yet. */
const GM_USERNAME = process.env.GM_USERNAME ?? 'gm';
const GM_PASSWORD = process.env.GM_PASSWORD ?? 'gm';

/** The web app's dev server and preview origins. This is a local tool, not public. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');

async function main(): Promise<void> {
  const campaigns = new CampaignStore();
  campaigns.restore(await readCampaignsSnapshot(CAMPAIGNS_SNAPSHOT_PATH));
  if (campaigns.size > 0) {
    console.log(`restored ${campaigns.size} campaign(s) from ${CAMPAIGNS_SNAPSHOT_PATH}`);
  }
  const persistCampaigns = (): void => {
    void writeCampaignsSnapshot(CAMPAIGNS_SNAPSHOT_PATH, campaigns.serialize()).catch((error: unknown) =>
      console.error('campaigns snapshot failed', error),
    );
  };

  // Characters are restored after campaigns: the library reads linked sheets from
  // the rooms, and the first boot with a library adopts every character already
  // sitting in one (see `adoptRoomCharacters`; idempotent on later boots).
  const characters = new CharacterStore();
  characters.restore(await readCharactersSnapshot(CHARACTERS_SNAPSHOT_PATH));
  const adopted = adoptRoomCharacters(characters, campaigns);
  if (adopted > 0) console.log(`filed ${adopted} character(s) from campaign rooms into their owners' libraries`);
  const writeCharacters = (): Promise<void> =>
    writeCharactersSnapshot(CHARACTERS_SNAPSHOT_PATH, serializeLibrary(characters, campaigns));
  const persistCharacters = (): void => {
    void writeCharacters().catch((error: unknown) => console.error('characters snapshot failed', error));
  };
  const persistTable = (): void => {
    persistCampaigns();
    persistCharacters();
  };
  if (adopted > 0) persistCharacters();

  const users = new UserStore();
  users.restore(await readUsersSnapshot(USERS_SNAPSHOT_PATH));
  const persistUsers = (): void => {
    void writeUsersSnapshot(USERS_SNAPSHOT_PATH, users.serialize()).catch((error: unknown) =>
      console.error('users snapshot failed', error),
    );
  };
  if (users.findByUsername(GM_USERNAME) === null) {
    await users.createUser(GM_USERNAME, GM_PASSWORD, 'gm');
    persistUsers();
    const usingDefaults = GM_USERNAME === 'gm' && GM_PASSWORD === 'gm';
    console.warn(
      `No GM account named "${GM_USERNAME}" existed — created it.` +
        (usingDefaults
          ? ' Using the default gm/gm credentials — set GM_USERNAME and GM_PASSWORD to change them.'
          : ''),
    );
  }
  const sessions = new SessionStore();
  const tunnel = new TunnelManager(PORT, WEB_DIST_DIR);

  // The HTTP routes are built before the socket server exists; this is only called
  // once a request arrives, by which point `io` is set.
  const broadcast = (campaignId: string, outcome: Patches): void => broadcastPatches(io, campaignId, outcome);
  const tableDeps = { campaigns, characters, users, sessions, persist: persistTable, broadcast };

  type Route = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
  const routes: readonly Route[] = [
    (request, response) => handleAuth(request, response, { users, sessions, persist: persistUsers }),
    (request, response) => handleCampaigns(request, response, tableDeps),
    (request, response) => handleCharacters(request, response, tableDeps),
    (request, response) => handleTunnel(request, response, { tunnel, users, sessions }),
    (request, response) => handleUploads(request, response, { directory: UPLOAD_DIR, users, sessions }),
    (request, response) => handleStatic(request, response, WEB_DIST_DIR),
  ];

  const http = createServer((request, response) => {
    // The web app runs on another origin in development.
    const origin = request.headers.origin;
    // Any cache between here and the browser must key on the origin, since the
    // allow-origin header varies with it.
    response.setHeader('vary', 'origin');
    if (origin !== undefined && ALLOWED_ORIGINS.includes(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-headers', 'content-type, authorization');
      response.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    // A health probe, so `pnpm dev` can tell the server is actually up.
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, campaigns: campaigns.size }));
      return;
    }

    // Each route reports whether it handled the request; the first one that did
    // ends the walk. A throw anywhere lands in the catch below rather than leaving
    // the socket open with no response.
    void (async () => {
      for (const route of routes) {
        if (await route(request, response)) return;
      }
      response.writeHead(404);
      response.end();
    })().catch((error: unknown) => {
      console.error('request failed', request.method, request.url, error);
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'internal' }));
    });
  });

  const io = new Server(http, { cors: { origin: ALLOWED_ORIGINS } });
  registerGateway(io, campaigns, sessions, users);

  const stopSnapshots = setInterval(persistTable, CAMPAIGNS_SNAPSHOT_INTERVAL_MS);
  stopSnapshots.unref();

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    // A second Ctrl-C must not start a second flush over the first one.
    if (shuttingDown) return;
    shuttingDown = true;
    tunnel.stop();
    clearInterval(stopSnapshots);
    // One last snapshot so a clean stop never loses the table's progress, accounts
    // included — a password set seconds before the stop was previously lost.
    await Promise.all([
      writeCampaignsSnapshot(CAMPAIGNS_SNAPSHOT_PATH, campaigns.serialize()).catch((error: unknown) =>
        console.error('final campaigns snapshot failed', error),
      ),
      writeUsersSnapshot(USERS_SNAPSHOT_PATH, users.serialize()).catch((error: unknown) =>
        console.error('final users snapshot failed', error),
      ),
      writeCharacters().catch((error: unknown) => console.error('final characters snapshot failed', error)),
    ]);
    // io.close() closes the http server it is attached to and waits for sockets.
    await io.close();
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  // A busy port is an ordinary mistake (an old instance still running), not a crash
  // worth a stack trace — and an unhandled 'error' here would take the web dev
  // server down with it under `pnpm dev`.
  http.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use — another server is probably still running. ` +
          `Stop it, or start this one with PORT=<other> pnpm dev:server.`,
      );
      process.exit(1);
    }
    throw error;
  });

  http.listen(PORT, () => {
    console.log(`Daggerheart VTT server listening on http://localhost:${PORT}`);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
