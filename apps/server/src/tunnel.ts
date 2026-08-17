import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { bin, install, Tunnel } from 'cloudflared';

/**
 * Owns the lifecycle of the (at most one) Cloudflare quick tunnel this server ever
 * opens. A tunnel exposes the whole server, not one campaign — there is nothing to
 * scope per campaign here. The GM triggers this from the UI; players only ever see
 * the resulting URL.
 */
export class TunnelManager {
  private url: string | null = null;
  private pending: Promise<string> | null = null;
  private tunnel: Tunnel | null = null;

  constructor(
    private readonly port: number,
    /** Where the web app's build lives, so a tunnel is never opened onto a server
     * with nothing to serve at `/`. */
    private readonly webDistDir: string,
  ) {}

  getUrl(): string | null {
    return this.url;
  }

  /** Closes the tunnel, if one is open. Safe to call even if none ever started. */
  stop(): void {
    this.tunnel?.stop();
    this.tunnel = null;
    this.url = null;
  }

  /** Starts the tunnel if none is running yet; otherwise returns the existing URL. */
  async ensure(): Promise<string> {
    if (this.url !== null) return this.url;
    if (this.pending !== null) return this.pending;

    this.pending = this.start().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async start(): Promise<string> {
    this.ensureWebBuilt();

    if (!existsSync(bin)) await install(bin);

    const tunnel = Tunnel.quick(`http://localhost:${this.port}`);
    this.tunnel = tunnel;
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a tunnel URL')), 30_000);
      tunnel.once('url', (found: string) => {
        clearTimeout(timer);
        resolve(found);
      });
      tunnel.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    this.url = url;
    return url;
  }

  /** Builds the web app with a same-origin API base, if no build exists yet. */
  private ensureWebBuilt(): void {
    if (existsSync(`${this.webDistDir}/index.html`)) return;

    const build = spawnSync('pnpm', ['-F', '@daggerheart/web', 'build'], {
      stdio: 'inherit',
      env: { ...process.env, VITE_SERVER_URL: '' },
    });
    if (build.status !== 0) throw new Error('building the web app failed');
  }
}
