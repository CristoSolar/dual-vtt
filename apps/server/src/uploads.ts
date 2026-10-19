import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream';

import { actorFor } from './http-auth.js';
import type { SessionStore } from './sessions.js';
import type { UserStore } from './users.js';

/**
 * Map image and playlist audio uploads. Files are stored on disk beside the room
 * snapshots and served back over HTTP; there is no cloud storage and no database.
 *
 * The file type is decided from the bytes on disk, not from what the browser claims,
 * and the size is capped before anything is written.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface FileType {
  extension: string;
  mime: string;
  /** Leading bytes that identify the format. */
  magic: readonly number[];
  /** Bytes to skip before matching, for formats with a container header. */
  offset?: number;
  /** Per-byte mask applied before comparing, for headers with variable bits. */
  mask?: readonly number[];
}

/** The formats accepted. Anything else is rejected outright. */
const FILE_TYPES: readonly FileType[] = [
  { extension: '.png', mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { extension: '.jpg', mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { extension: '.gif', mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  // WEBP is "RIFF....WEBP": the tag sits after the 4-byte size field.
  { extension: '.webp', mime: 'image/webp', magic: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { extension: '.ogg', mime: 'audio/ogg', magic: [0x4f, 0x67, 0x67, 0x53] },
  { extension: '.mp3', mime: 'audio/mpeg', magic: [0x49, 0x44, 0x33] },
  // An MP3 without an ID3 tag opens on a frame header: eleven set sync bits.
  { extension: '.mp3', mime: 'audio/mpeg', magic: [0xff, 0xe0], mask: [0xff, 0xe0] },
];

/** Identifies an upload from its leading bytes, or null if it is not one we accept. */
export function detectFileType(bytes: Uint8Array): FileType | null {
  for (const type of FILE_TYPES) {
    const offset = type.offset ?? 0;
    if (bytes.length < offset + type.magic.length) continue;
    const matches = type.magic.every((byte, index) => {
      const actual = bytes[offset + index] ?? 0;
      return (actual & (type.mask?.[index] ?? 0xff)) === byte;
    });
    if (matches) return type;
  }
  return null;
}

export interface StoredUpload {
  url: string;
  path: string;
  bytes: number;
}

/** Writes an upload, giving it a random name and a verified extension. */
export async function storeUpload(directory: string, bytes: Uint8Array): Promise<StoredUpload> {
  const type = detectFileType(bytes);
  if (type === null) throw new Error('unsupported file type');

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
  FILE_TYPES.map((type) => [type.extension, type.mime]),
);

/**
 * One `bytes=start-end` range, `end` inclusive and clamped to the file. A suffix
 * (`bytes=-500`) counts back from the end. Multiple ranges are not supported and,
 * like an unsatisfiable one, come back null.
 */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return null;
  if (from === '') {
    const length = Number(to);
    if (length === 0) return null;
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || start > end) return null;
  return { start, end };
}

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

/**
 * Handles `POST /uploads` and `GET /uploads/:name`. Returns true when it handled the
 * request, so the caller can fall through to its other routes.
 *
 * The body is the raw file; there is no multipart parsing to get wrong.
 */
export interface UploadsDeps {
  directory: string;
  users: UserStore;
  sessions: SessionStore;
}

export async function handleUploads(
  request: IncomingMessage,
  response: ServerResponse,
  { directory, users, sessions }: UploadsDeps,
): Promise<boolean> {
  const url = request.url ?? '';

  if (request.method === 'POST' && url === '/uploads') {
    // Writing to the server's disk is for people with an account. Without this a
    // public tunnel lets anyone fill it up.
    if (actorFor(request, sessions, users) === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
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
    // ponytail: reads stay open — an <img> tag cannot send an Authorization header,
    // and the 24-hex random filename is the capability. Gate it behind a signed URL
    // only if uploads ever hold something worth hiding from a guessed link.
    //
    // Decoded before it is checked, so an encoded separator (%2f) is rejected by the
    // guard below rather than sailing past it, and so a name with a space still
    // resolves. The query string is not part of the name.
    let name: string;
    try {
      name = decodeURIComponent(url.slice('/uploads/'.length).split('?')[0] ?? '');
    } catch {
      json(response, 400, { error: 'bad path' });
      return true;
    }
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
      const header = request.headers.range;
      if (header === undefined) {
        response.writeHead(200, {
          'content-type': mime,
          'content-length': info.size,
          'accept-ranges': 'bytes',
        });
        // pipeline, not .pipe: .pipe leaves the read stream's fd open when the
        // client aborts mid-body (an <audio> range request does this constantly),
        // and adds no 'error' listener, so a file vanishing after stat would crash
        // the process instead of just failing this request.
        pipeline(createReadStream(path), response, () => {});
        return true;
      }
      // A player joining mid-song seeks into the track, and a browser cannot seek
      // an <audio> whose server ignores ranges.
      const range = parseRange(header, info.size);
      if (range === null) {
        response.writeHead(416, { 'content-range': `bytes */${info.size}` });
        response.end();
        return true;
      }
      response.writeHead(206, {
        'content-type': mime,
        'content-length': range.end - range.start + 1,
        'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
        'accept-ranges': 'bytes',
      });
      pipeline(createReadStream(path, range), response, () => {});
    } catch {
      json(response, 404, { error: 'not found' });
    }
    return true;
  }

  return false;
}
