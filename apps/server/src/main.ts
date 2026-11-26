import { startServer } from './server.js';

/**
 * `pnpm start` / `pnpm host` / Docker: the server configured from env vars. The
 * desktop app calls `startServer` itself with its own paths (see apps/desktop).
 */

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
  let server;
  try {
    server = await startServer({
      port: PORT,
      campaignsSnapshotPath: CAMPAIGNS_SNAPSHOT_PATH,
      campaignsSnapshotIntervalMs: CAMPAIGNS_SNAPSHOT_INTERVAL_MS,
      usersSnapshotPath: USERS_SNAPSHOT_PATH,
      charactersSnapshotPath: CHARACTERS_SNAPSHOT_PATH,
      uploadDir: UPLOAD_DIR,
      webDistDir: WEB_DIST_DIR,
      bootGm: { username: GM_USERNAME, password: GM_PASSWORD },
      firstRunSetup: false,
      allowedOrigins: ALLOWED_ORIGINS,
    });
  } catch (error) {
    // A busy port is an ordinary mistake (an old instance still running), not a crash
    // worth a stack trace — and a crash here would take the web dev server down with
    // it under `pnpm dev`.
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use — another server is probably still running. ` +
          `Stop it, or start this one with PORT=<other> pnpm dev:server.`,
      );
      process.exit(1);
    }
    throw error;
  }

  const stop = (): void => void server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`Daggerheart VTT server listening on http://localhost:${server.port}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
