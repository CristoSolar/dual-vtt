import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Server } from 'socket.io';

import { handleAuth } from './auth-http.js';
import { CampaignStore } from './campaigns.js';
import { handleCampaigns } from './campaigns-http.js';
import { readCampaignsSnapshot, writeCampaignsSnapshot } from './campaigns-snapshot.js';
import { CharacterStore } from './characters.js';
import { handleCharacters } from './characters-http.js';
import { readCharactersSnapshot, writeCharactersSnapshot } from './characters-snapshot.js';
import { broadcastPatches, registerGateway, unseatPlayers } from './gateway.js';
import { adoptRoomCharacters, serializeLibrary, type Patches } from './library.js';
import { handlePlayers } from './players-http.js';
import { SessionStore } from './sessions.js';
import { handleSetup } from './setup-http.js';
import { handleStatic } from './static.js';
import { handleTunnel } from './tunnel-http.js';
import { TunnelManager } from './tunnel.js';
import { handleUploads } from './uploads.js';
import { UserStore } from './users.js';
import { readUsersSnapshot, writeUsersSnapshot } from './users-snapshot.js';

/**
 * Everything the server needs from its surroundings. `main.ts` fills it from env
 * vars (`pnpm start`/`host`, Docker); the desktop app fills it from Electron's
 * userData directory. Nothing in here reads `process.env`.
 */
export interface ServerOptions {
  port: number;
  /** Interface to bind. Omitted: Node's default (every interface). */
  host?: string;
  campaignsSnapshotPath: string;
  campaignsSnapshotIntervalMs: number;
  usersSnapshotPath: string;
  charactersSnapshotPath: string;
  uploadDir: string;
  /** The web app's production build; a missing directory just serves nothing. */
  webDistDir: string;
  /**
   * The GM account created on boot when no account by this name exists yet, or null
   * to create none — the desktop app, which asks for one on first run instead.
   */
  bootGm: { username: string; password: string } | null;
  /** Whether `POST /setup` may create the first GM while there is none. */
  firstRunSetup: boolean;
  /** Origins allowed to call the API cross-origin (the Vite dev server). */
  allowedOrigins: readonly string[];
  /** Where the cloudflared binary lives or is downloaded to; default: the npm package's own. */
  cloudflaredBin?: string;
}

export interface RunningServer {
  /** The port actually bound (differs from the option only when that was 0). */
  port: number;
  /** Writes one last snapshot of everything, stops the tunnel and closes every socket. */
  close: () => Promise<void>;
}

/**
 * Restores the stores from disk, wires the HTTP routes and the socket gateway, and
 * listens. Rejects if the port cannot be bound (`EADDRINUSE` included), so callers
 * decide what a busy port means for them.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { campaignsSnapshotPath, charactersSnapshotPath, usersSnapshotPath } = options;

  const campaigns = new CampaignStore();
  campaigns.restore(await readCampaignsSnapshot(campaignsSnapshotPath));
  if (campaigns.size > 0) {
    console.log(`restored ${campaigns.size} campaign(s) from ${campaignsSnapshotPath}`);
  }
  const persistCampaigns = (): void => {
    void writeCampaignsSnapshot(campaignsSnapshotPath, campaigns.serialize()).catch((error: unknown) =>
      console.error('campaigns snapshot failed', error),
    );
  };

  // Characters are restored after campaigns: the library reads linked sheets from
  // the rooms, and the first boot with a library adopts every character already
  // sitting in one (see `adoptRoomCharacters`; idempotent on later boots).
  const characters = new CharacterStore();
  const charactersSnapshot = await readCharactersSnapshot(charactersSnapshotPath);
  characters.restore(charactersSnapshot.characters);
  const adopted = adoptRoomCharacters(characters, campaigns);
  if (adopted > 0) console.log(`filed ${adopted} character(s) from campaign rooms into their owners' libraries`);
  const writeCharacters = (): Promise<void> =>
    writeCharactersSnapshot(charactersSnapshotPath, serializeLibrary(characters, campaigns), charactersSnapshot.unreadable);
  const persistCharacters = (): void => {
    void writeCharacters().catch((error: unknown) => console.error('characters snapshot failed', error));
  };
  const persistTable = (): void => {
    persistCampaigns();
    persistCharacters();
  };
  if (adopted > 0) persistCharacters();

  const users = new UserStore();
  users.restore(await readUsersSnapshot(usersSnapshotPath));
  const persistUsers = (): void => {
    void writeUsersSnapshot(usersSnapshotPath, users.serialize()).catch((error: unknown) =>
      console.error('users snapshot failed', error),
    );
  };
  const { bootGm } = options;
  if (bootGm !== null && users.findByUsername(bootGm.username) === null) {
    await users.createUser(bootGm.username, bootGm.password, 'gm');
    persistUsers();
    const usingDefaults = bootGm.username === 'gm' && bootGm.password === 'gm';
    console.warn(
      `No GM account named "${bootGm.username}" existed — created it.` +
        (usingDefaults
          ? ' Using the default gm/gm credentials — set GM_USERNAME and GM_PASSWORD to change them.'
          : ''),
    );
  }
  const sessions = new SessionStore();
  const tunnel = new TunnelManager(options.port, options.webDistDir, options.cloudflaredBin);

  // The HTTP routes are built before the socket server exists; this is only called
  // once a request arrives, by which point `io` is set.
  const broadcast = (campaignId: string, outcome: Patches): void => broadcastPatches(io, campaignId, outcome);
  const tableDeps = {
    campaigns,
    characters,
    users,
    sessions,
    persist: persistTable,
    persistUsers,
    broadcast,
    unseatPlayers: (campaignId: string): void => unseatPlayers(io, campaigns, campaignId),
  };

  type Route = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
  const routes: readonly Route[] = [
    (request, response) =>
      handleSetup(request, response, { users, sessions, enabled: options.firstRunSetup, persist: persistUsers }),
    (request, response) => handleAuth(request, response, { users, campaigns, sessions, persist: persistUsers }),
    (request, response) => handleCampaigns(request, response, tableDeps),
    (request, response) => handleCharacters(request, response, tableDeps),
    (request, response) => handlePlayers(request, response, { campaigns, users, sessions }),
    (request, response) => handleTunnel(request, response, { tunnel, users, sessions }),
    (request, response) => handleUploads(request, response, { directory: options.uploadDir, users, sessions }),
    (request, response) => handleStatic(request, response, options.webDistDir),
  ];

  const allowedOrigins = options.allowedOrigins;
  const http = createServer((request, response) => {
    // The web app runs on another origin in development.
    const origin = request.headers.origin;
    // Any cache between here and the browser must key on the origin, since the
    // allow-origin header varies with it.
    response.setHeader('vary', 'origin');
    if (origin !== undefined && allowedOrigins.includes(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-headers', 'content-type, authorization');
      response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
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

  const io = new Server(http, { cors: { origin: [...allowedOrigins] } });
  registerGateway(io, campaigns, sessions, users);

  // Bind before starting the snapshot timer, so a busy port leaves nothing running.
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    http.once('error', onError);
    const onListening = (): void => {
      http.off('error', onError);
      resolve();
    };
    if (options.host === undefined) http.listen(options.port, onListening);
    else http.listen(options.port, options.host, onListening);
  });
  http.on('error', (error) => console.error('http server error', error));

  const stopSnapshots = setInterval(persistTable, options.campaignsSnapshotIntervalMs);
  stopSnapshots.unref();

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    // A second Ctrl-C (or quit) must not start a second flush over the first one.
    closing ??= (async () => {
      tunnel.stop();
      clearInterval(stopSnapshots);
      // One last snapshot so a clean stop never loses the table's progress, accounts
      // included — a password set seconds before the stop was previously lost.
      await Promise.all([
        writeCampaignsSnapshot(campaignsSnapshotPath, campaigns.serialize()).catch((error: unknown) =>
          console.error('final campaigns snapshot failed', error),
        ),
        writeUsersSnapshot(usersSnapshotPath, users.serialize()).catch((error: unknown) =>
          console.error('final users snapshot failed', error),
        ),
        writeCharacters().catch((error: unknown) => console.error('final characters snapshot failed', error)),
      ]);
      // io.close() closes the http server it is attached to and waits for sockets.
      await io.close();
    })();
    return closing;
  };

  return { port: (http.address() as AddressInfo).port, close };
}
