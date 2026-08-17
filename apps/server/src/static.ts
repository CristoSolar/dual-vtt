import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

/**
 * Serves the web app's production build, when one exists. `pnpm dev`'s Vite dev
 * server serves the app itself, so `distDir` is absent in that flow and this
 * handles nothing — it only matters for `pnpm host` (see host.ts), where the
 * server serves both the built app and the API from the same origin.
 *
 * The app uses a `HashRouter` (`apps/web/src/App.tsx`), so the server never sees
 * a client-side route like `/campaigns` — only `/` and the build's own asset
 * paths. That's why the fallback below is just "serve index.html for anything
 * that isn't a real file", not a route-aware catch-all.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function serveFile(response: ServerResponse, path: string): Promise<boolean> {
  const mime = MIME_BY_EXTENSION[extname(path)];
  if (mime === undefined) return false;

  try {
    const info = await stat(path);
    response.writeHead(200, { 'content-type': mime, 'content-length': info.size });
    createReadStream(path).pipe(response);
    return true;
  } catch {
    return false;
  }
}

/**
 * Handles any `GET` request once every other route has passed on it. Returns
 * true when it handled the request, so the caller can fall through to its 404.
 */
export async function handleStatic(
  request: IncomingMessage,
  response: ServerResponse,
  distDir: string,
): Promise<boolean> {
  if (request.method !== 'GET') return false;

  const url = request.url ?? '/';
  const path = url.split('?')[0] ?? '/';

  if (path === '/' || path === '/index.html') {
    return serveFile(response, join(distDir, 'index.html'));
  }

  // Reject anything that could escape distDir, same guard as uploads.ts's
  // GET /uploads/:name.
  const relative = path.slice(1);
  if (relative.includes('..') || relative.includes('\\') || normalize(relative) !== relative) {
    return false;
  }

  const served = await serveFile(response, join(distDir, relative));
  if (served) return true;

  // Not a real asset — the HashRouter's job, so hand it index.html too.
  return serveFile(response, join(distDir, 'index.html'));
}
