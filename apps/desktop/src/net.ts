import { createServer } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';

/**
 * The few decisions the desktop shell makes that do not need Electron, kept apart
 * so they can be tested in plain Node.
 */

/** True when `port` can be bound on `host` right now. */
export function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/**
 * The first free port of `preferred, preferred + 1, …` (`attempts` in all), else
 * one the OS picks. Staying near the preferred port matters: the window's origin
 * includes the port, and the browser storage behind it (saved login, creation
 * drafts, language) belongs to that origin.
 */
export async function findPort(preferred: number, host: string, attempts = 10): Promise<number> {
  for (let port = preferred; port < preferred + attempts; port += 1) {
    if (await isPortFree(port, host)) return port;
  }
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The machine's LAN IPv4 addresses, private ranges first, for the "copy LAN link"
 * menu entry. Loopback, link-local (169.254/16) and IPv6 are left out: a player
 * types this into a phone.
 */
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const found: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
      found.push(entry.address);
    }
  }
  const isPrivate = (address: string): boolean =>
    address.startsWith('192.168.') ||
    address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address);
  return [...found.filter(isPrivate), ...found.filter((address) => !isPrivate(address))];
}

/** Whether `url` stays inside the app (same origin as the local server). */
export function isAppUrl(url: string, appOrigin: string): boolean {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

/** Whether `url` may be handed to the system browser: web links only, never file: or custom schemes. */
export function isExternalWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
