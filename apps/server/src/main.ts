import { createServer } from 'node:http';

import { Server } from 'socket.io';

import { registerGateway } from './gateway.js';
import { handleAuth } from './auth-http.js';
import { RoomStore } from './rooms.js';
import { SessionStore } from './sessions.js';
import { readSnapshot, startSnapshots, writeSnapshot } from './snapshot.js';
import { handleUploads } from './uploads.js';
import { UserStore } from './users.js';
import { readUsersSnapshot, writeUsersSnapshot } from './users-snapshot.js';

const PORT = Number(process.env.PORT ?? 4000);
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH ?? '.data/rooms.json';
const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 15_000);
/** Map images live beside the room snapshots. */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '.data/uploads';
const USERS_SNAPSHOT_PATH = process.env.USERS_SNAPSHOT_PATH ?? '.data/users.json';
/** The first GM account, created on boot if no account by this name exists yet. */
const GM_USERNAME = process.env.GM_USERNAME ?? 'gm';
const GM_PASSWORD = process.env.GM_PASSWORD ?? 'gm';

/** The web app's dev server and preview origins. This is a local tool, not public. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');

async function main(): Promise<void> {
  const store = new RoomStore();
  store.restore(await readSnapshot(SNAPSHOT_PATH));
  if (store.size > 0) console.log(`restored ${store.size} room(s) from ${SNAPSHOT_PATH}`);

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

  const http = createServer((request, response) => {
    // The web app runs on another origin in development.
    const origin = request.headers.origin;
    if (origin !== undefined && ALLOWED_ORIGINS.includes(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-headers', 'content-type, authorization');
      response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    // A health probe, so `pnpm dev` can tell the server is actually up.
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: store.size }));
      return;
    }

    void handleAuth(request, response, { users, sessions, persist: persistUsers }).then((handled) => {
      if (handled) return;
      void handleUploads(request, response, UPLOAD_DIR).then((uploadHandled) => {
        if (uploadHandled) return;
        response.writeHead(404);
        response.end();
      });
    });
  });

  const io = new Server(http, { cors: { origin: ALLOWED_ORIGINS } });
  registerGateway(io, store);

  const stopSnapshots = startSnapshots(store, SNAPSHOT_PATH, SNAPSHOT_INTERVAL_MS, (error) =>
    console.error('snapshot failed', error),
  );

  const shutdown = async (): Promise<void> => {
    stopSnapshots();
    // One last snapshot so a clean stop never loses the table's progress.
    await writeSnapshot(SNAPSHOT_PATH, store.serialize()).catch((error: unknown) =>
      console.error('final snapshot failed', error),
    );
    await io.close();
    http.close();
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
