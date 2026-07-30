import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

/**
 * Map image uploads. Images are stored on disk beside the room snapshots and served
 * back over HTTP; there is no cloud storage and no database.
 *
 * The file type is decided from the bytes on disk, not from what the browser claims,
 * and the size is capped before anything is written.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface ImageType {
  extension: string;
  mime: string;
  /** Leading bytes that identify the format. */
  magic: readonly number[];
  /** Bytes to skip before matching, for formats with a container header. */
  offset?: number;
}

/** The formats accepted. Anything else is rejected outright. */
const IMAGE_TYPES: readonly ImageType[] = [
  { extension: '.png', mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { extension: '.jpg', mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { extension: '.gif', mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  // WEBP is "RIFF....WEBP": the tag sits after the 4-byte size field.
  { extension: '.webp', mime: 'image/webp', magic: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

/** Identifies an image from its leading bytes, or null if it is not one we accept. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  for (const type of IMAGE_TYPES) {
    const offset = type.offset ?? 0;
    if (bytes.length < offset + type.magic.length) continue;
    if (type.magic.every((byte, index) => bytes[offset + index] === byte)) return type;
  }
  return null;
}

export interface StoredUpload {
  url: string;
  path: string;
  bytes: number;
}

/** Writes an uploaded image, giving it a random name and a verified extension. */
export async function storeUpload(directory: string, bytes: Uint8Array): Promise<StoredUpload> {
  const type = detectImageType(bytes);
  if (type === null) throw new Error('unsupported image type');

  await mkdir(directory, { recursive: true });
  const name = `${randomBytes(12).toString('hex')}${type.extension}`;
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { url: `/uploads/${name}`, path, bytes: bytes.length };
}

/** Reads a request body, refusing anything past the cap without buffering it all. */
export async function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw new Error('upload too large');
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  IMAGE_TYPES.map((type) => [type.extension, type.mime]),
);

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

/**
 * Handles `POST /uploads` and `GET /uploads/:name`. Returns true when it handled the
 * request, so the caller can fall through to its other routes.
 *
 * The body is the raw image; there is no multipart parsing to get wrong.
 */
export async function handleUploads(
  request: IncomingMessage,
  response: ServerResponse,
  directory: string,
): Promise<boolean> {
  const url = request.url ?? '';

  if (request.method === 'POST' && url === '/uploads') {
    try {
      const bytes = await readBody(request, MAX_UPLOAD_BYTES);
      const stored = await storeUpload(directory, bytes);
      json(response, 201, { url: stored.url, bytes: stored.bytes });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upload failed';
      json(response, message === 'upload too large' ? 413 : 415, { error: message });
    }
    return true;
  }

  if (request.method === 'GET' && url.startsWith('/uploads/')) {
    const name = url.slice('/uploads/'.length);
    // Reject anything that could escape the uploads directory.
    if (name === '' || name.includes('/') || name.includes('\\') || normalize(name) !== name) {
      json(response, 400, { error: 'bad path' });
      return true;
    }

    const mime = MIME_BY_EXTENSION[extname(name)];
    if (mime === undefined) {
      json(response, 404, { error: 'not found' });
      return true;
    }

    const path = join(directory, name);
    try {
      const info = await stat(path);
      response.writeHead(200, { 'content-type': mime, 'content-length': info.size });
      createReadStream(path).pipe(response);
    } catch {
      json(response, 404, { error: 'not found' });
    }
    return true;
  }

  return false;
}
