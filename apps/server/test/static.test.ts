import { createServer, type Server as HttpServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleStatic } from '../src/static.js';

async function startStaticServer(distDir: string) {
  const http: HttpServer = createServer((request, response) => {
    void handleStatic(request, response, distDir).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address() as AddressInfo;
  return {
    url: `http://localhost:${address.port}`,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

describe('serving the web build', () => {
  let distDir: string;
  let server: Awaited<ReturnType<typeof startStaticServer>>;

  beforeAll(async () => {
    distDir = await mkdtemp(join(tmpdir(), 'dh-dist-'));
    await writeFile(join(distDir, 'index.html'), '<html>index</html>');
    await mkdir(join(distDir, 'assets'), { recursive: true });
    await writeFile(join(distDir, 'assets', 'app.js'), 'console.log("app")');
    server = await startStaticServer(distDir);
  });

  afterAll(async () => {
    await server.close();
    await rm(distDir, { recursive: true, force: true });
  });

  it('serves index.html at the root', async () => {
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toBe('<html>index</html>');
  });

  it('serves a real asset with the content-type its extension implies', async () => {
    const response = await fetch(`${server.url}/assets/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(await response.text()).toBe('console.log("app")');
  });

  it('falls back to index.html for a route the HashRouter owns client-side', async () => {
    const response = await fetch(`${server.url}/campaigns`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>index</html>');
  });

  it('refuses to serve outside distDir', async () => {
    const response = await fetch(`${server.url}/../../../etc/passwd`);
    // A traversal attempt is either rejected outright or, once the browser/
    // fetch client normalizes the URL, lands back inside distDir and gets the
    // index.html fallback like any other unknown path — never a 200 with
    // content from outside distDir.
    if (response.status === 200) {
      expect(await response.text()).toBe('<html>index</html>');
    } else {
      expect(response.status).toBe(404);
    }
  });

  it('does nothing for a POST request', async () => {
    const response = await fetch(`${server.url}/`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

describe('when there is no build', () => {
  it('handles nothing, so the caller falls through to its own 404', async () => {
    const missing = join(tmpdir(), 'dh-dist-does-not-exist');
    const server = await startStaticServer(missing);
    try {
      const response = await fetch(`${server.url}/`);
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
