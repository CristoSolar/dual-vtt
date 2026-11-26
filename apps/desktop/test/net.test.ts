import { createServer, type Server } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { findPort, isAppUrl, isExternalWebUrl, isPortFree, lanAddresses } from '../src/net.js';

const listen = (port: number): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '127.0.0.1', () => resolve(server));
  });

describe('port choice', () => {
  const open: Server[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('keeps the preferred port when it is free', async () => {
    const probe = await listen(0);
    const port = (probe.address() as { port: number }).port;
    await new Promise((resolve) => probe.close(resolve));
    expect(await findPort(port, '127.0.0.1')).toBe(port);
  });

  it('moves to the next free one when the preferred is taken', async () => {
    const taken = await listen(0);
    open.push(taken);
    const port = (taken.address() as { port: number }).port;
    expect(await isPortFree(port, '127.0.0.1')).toBe(false);
    const chosen = await findPort(port, '127.0.0.1');
    expect(chosen).not.toBe(port);
    expect(await isPortFree(chosen, '127.0.0.1')).toBe(true);
  });
});

const iface = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false): NetworkInterfaceInfo =>
  ({ address, family, internal, netmask: '', mac: '', cidr: null }) as NetworkInterfaceInfo;

describe('lanAddresses', () => {
  it('lists private IPv4 first and drops loopback, link-local and IPv6', () => {
    expect(
      lanAddresses({
        lo: [iface('127.0.0.1', 'IPv4', true), iface('::1', 'IPv6', true)],
        vpn: [iface('100.64.1.2')],
        wlan0: [iface('192.168.1.20'), iface('fe80::1', 'IPv6')],
        eth9: [iface('169.254.3.4')],
        docker0: [iface('172.17.0.1')],
      }),
    ).toEqual(['192.168.1.20', '172.17.0.1', '100.64.1.2']);
  });
});

describe('navigation guards', () => {
  const origin = 'http://localhost:4000';
  it('keeps same-origin URLs in the app', () => {
    expect(isAppUrl('http://localhost:4000/#/campaigns', origin)).toBe(true);
    expect(isAppUrl('http://localhost:4001/', origin)).toBe(false);
    expect(isAppUrl('https://evil.example/', origin)).toBe(false);
    expect(isAppUrl('not a url', origin)).toBe(false);
  });
  it('hands only web links to the system browser', () => {
    expect(isExternalWebUrl('https://www.daggerheart.com')).toBe(true);
    expect(isExternalWebUrl('file:///etc/passwd')).toBe(false);
    expect(isExternalWebUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalWebUrl('smb://host/share')).toBe(false);
  });
});
