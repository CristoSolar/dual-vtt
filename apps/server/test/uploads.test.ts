import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { detectImageType, MAX_UPLOAD_BYTES, storeUpload } from '../src/uploads.js';

const png = (extra = 0) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(extra).fill(0)]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const gif = () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const webp = () =>
  new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

describe('image type detection', () => {
  it('accepts the formats a map might be in', () => {
    expect(detectImageType(png())?.extension).toBe('.png');
    expect(detectImageType(jpeg())?.extension).toBe('.jpg');
    expect(detectImageType(gif())?.extension).toBe('.gif');
    expect(detectImageType(webp())?.extension).toBe('.webp');
  });

  it('rejects anything that is not an image, whatever it claims to be', () => {
    // An executable, a script, and an HTML page all fail on their bytes.
    expect(detectImageType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('#!/bin/sh\nrm -rf /'))).toBeNull();
    expect(detectImageType(new Uint8Array([]))).toBeNull();
  });

  it('does not mistake a truncated header for a valid image', () => {
    expect(detectImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    // RIFF without the WEBP tag is some other RIFF container.
    expect(
      detectImageType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]),
      ),
    ).toBeNull();
  });
});

describe('storing an upload', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dh-uploads-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes the file and returns a served URL', async () => {
    const stored = await storeUpload(directory, png(64));

    expect(stored.url).toMatch(/^\/uploads\/[a-f0-9]{24}\.png$/);
    expect(stored.bytes).toBe(72);

    // The bytes on disk are the bytes that were uploaded.
    const written = await readFile(stored.path);
    expect(new Uint8Array(written)).toEqual(png(64));
  });

  it('names files randomly, so an upload cannot overwrite another', async () => {
    const first = await storeUpload(directory, png());
    const second = await storeUpload(directory, png());
    expect(first.url).not.toBe(second.url);
  });

  it('gives the file the extension its bytes justify, not one a client chose', async () => {
    expect((await storeUpload(directory, jpeg())).url.endsWith('.jpg')).toBe(true);
    expect((await storeUpload(directory, webp())).url.endsWith('.webp')).toBe(true);
  });

  it('refuses to store a non-image', async () => {
    await expect(storeUpload(directory, new TextEncoder().encode('not an image'))).rejects.toThrow(
      'unsupported image type',
    );
  });

  it('caps uploads well below anything that would exhaust memory', () => {
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });
});
