import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadImage } from '../src/state/uploadMap.js';

/**
 * The upload endpoint writes to the server's disk, so it requires a session. The
 * browser has to say who it is; forgetting the header is a 401 that looks like a
 * broken map picker, which is exactly what happened once.
 */

/** The browser bits `readDimensions` needs, which the node test environment lacks. */
function stubBrowser(): void {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 800;
    naturalHeight = 600;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
}

const file = (): File =>
  ({ type: 'image/png', size: 1024 }) as unknown as File;

afterEach(() => vi.unstubAllGlobals());

describe('uploadImage', () => {
  it('sends the session token with the file', async () => {
    stubBrowser();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/uploads/abc.png' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const image = await uploadImage(file(), 'tok-123');

    expect(image).toEqual({ url: '/uploads/abc.png', width: 800, height: 600 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-123');
  });

  it('refuses before the round trip when there is no session', async () => {
    stubBrowser();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadImage(file(), null)).rejects.toThrow(/sign in/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the server’s own refusal', async () => {
    stubBrowser();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'unauthorized' }) }),
    );

    await expect(uploadImage(file(), 'tok-123')).rejects.toThrow('unauthorized');
  });
});
