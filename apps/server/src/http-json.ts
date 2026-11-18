import type { IncomingMessage, ServerResponse } from 'node:http';

import { readBody } from './uploads.js';

/** Small JSON helpers shared by the campaigns and characters routes. */

export const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

export const noContent = (response: ServerResponse): void => {
  response.writeHead(204);
  response.end();
};

/** A sheet is the largest body these routes take; 256 KiB leaves it ample room. */
const MAX_JSON_BODY_BYTES = 256 * 1024;

/** The parsed body, or null when it is missing, too large, or not JSON. */
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  try {
    const bytes = await readBody(request, MAX_JSON_BODY_BYTES);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}
