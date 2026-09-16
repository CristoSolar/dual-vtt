// Seeds a throwaway server with a campaign, a player and a claimed character, then
// screenshots the main routes with Playwright driving the system chromium.
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';
import { finalize } from '@daggerheart/character';
import { setLocale } from '@daggerheart/srd-data';
import { createSheet } from '@daggerheart/protocol';
import { buildCharacter } from '/home/admin/Repositorios/daggerheart-vtt/packages/character/test/helpers.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const API = 'http://localhost:4000';
const WEB = 'http://localhost:5173';
const OUT = '/home/admin/Repositorios/daggerheart-vtt/docs/screenshots';
const LOCALE = process.env.SHOT_LOCALE ?? 'es';

async function api(path: string, body?: unknown, token?: string) {
  const res = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function login(username: string, password: string) {
  const r = await api('/login', { username, password }).catch(() => api('/login', { username, password: password + '-changed' }));
  if (r.user.mustChangePassword) {
    await api('/change-password', { currentPassword: password, newPassword: password + '-changed' }, r.token);
    return api('/login', { username, password: password + '-changed' });
  }
  return r;
}

function socketFor(token: string, campaignId: string): Promise<ReturnType<typeof io>> {
  return new Promise((resolve, reject) => {
    const s = io(API, { transports: ['websocket'], auth: { token } });
    s.on('connect', () => s.emit('joinCampaign', { campaignId }));
    s.on('roomState', () => resolve(s));
    s.on('rejected', (e) => console.error('rejected', e));
    s.on('connect_error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gm = await login('gm', 'gm');
try { await api('/users', { username: 'aria', password: 'aria' }, gm.token); } catch {}
const player = await login('aria', 'aria');
const campaign = await api('/campaigns', { name: 'Sombras de Hallowmere' }, gm.token);
await api(`/campaigns/${campaign.id}/players`, { username: 'aria' }, gm.token);

setLocale(LOCALE as 'es' | 'en');
const character = finalize(buildCharacter('bard'));
character.name = 'Aria Vendrell';
const cid = player.user.id as string;
const sheet = createSheet(character);

const gmSock = await socketFor(gm.token, campaign.id);
const plSock = await socketFor(player.token, campaign.id);
plSock.emit('claimCharacter', { sheet });
await sleep(300);

const intent = (s: ReturnType<typeof io>, event: unknown) => s.emit('intent', event);
intent(plSock, { type: 'markHP', characterId: cid, amount: 2 });
intent(plSock, { type: 'markStress', characterId: cid, amount: 1 });
intent(plSock, { type: 'gainHope', characterId: cid, amount: 1 });
intent(plSock, { type: 'rollDuality', characterId: cid, request: { label: 'Presencia', modifiers: 2, difficulty: 12, advantage: 1, disadvantage: 0, experiences: [] } });

intent(gmSock, { type: 'gainFear', amount: 4 });
intent(gmSock, { type: 'addAdversary', instanceId: 'adv-1', adversaryId: 'cave-ogre', name: 'Ogro de la caverna' });
intent(gmSock, { type: 'addAdversary', instanceId: 'adv-2', adversaryId: 'bear', name: 'Oso' });
intent(gmSock, { type: 'addCountdown', id: 'cd-1', name: 'Refuerzos', kind: 'standard', startingValue: 6, loop: 'none' });
intent(gmSock, { type: 'addScene', id: 'scene-1', name: 'Puente de la caverna' });
intent(gmSock, { type: 'setActiveScene', id: 'scene-1' });
intent(gmSock, { type: 'setSceneGrid', sceneId: 'scene-1', grid: { mode: 'square', size: 70, offsetX: 0, offsetY: 0, feetPerInch: 5, color: '#5c5470', lineWidth: 1 } });
const token = (id: string, kind: string, refId: string | null, name: string, x: number, y: number, color: string, ownerId: string | null) => ({
  id, kind, refId, name, x, y, width: 70, height: 70, rotation: 0, ownerId, hidden: false, showRings: kind === 'pc', color, image: null, colorFrame: false, visionRadius: 720,
});
intent(gmSock, { type: 'addToken', sceneId: 'scene-1', token: token('t-pc', 'pc', cid, 'Aria', 560, 330, '#d4a24c', player.user.id) });
intent(gmSock, { type: 'addToken', sceneId: 'scene-1', token: token('t-adv1', 'adversary', 'adv-1', 'Ogro', 700, 280, '#b33a3a', null) });
intent(gmSock, { type: 'addToken', sceneId: 'scene-1', token: token('t-adv2', 'adversary', 'adv-2', 'Oso', 770, 490, '#8a5a2b', null) });
intent(gmSock, { type: 'addToken', sceneId: 'scene-1', token: token('t-m', 'marker', null, 'Altar', 560, 560, '#4c7fd4', null) });
intent(gmSock, { type: 'setSpotlight', spotlight: cid });
await sleep(500);

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
async function shoot(auth: { token: string; user: unknown }, route: string, file: string, opts: { full?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await ctx.addInitScript(({ auth, campaignId, userId, locale }: { auth: unknown; campaignId: string; userId: string; locale: string }) => {
    localStorage.setItem('daggerheart-vtt:auth', JSON.stringify(auth));
    localStorage.setItem('daggerheart-vtt:active-campaign', campaignId);
    localStorage.setItem(`daggerheart-vtt:guide-seen:${userId}`, '1');
    localStorage.setItem('daggerheart-vtt:locale', locale);
  }, { auth, campaignId: campaign.id, userId: (auth.user as { id: string }).id, locale: LOCALE });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/#/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.evaluate((r: string) => { location.hash = '#' + r; }, route);
  await sleep(2000);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: opts.full ?? false });
  await ctx.close();
  console.log('shot', file);
}

await shoot(player, '/', 'home');
await shoot(player, '/sheet', 'sheet');
await shoot(gm, '/gm', 'gm-panel');
await shoot(gm, '/map', 'map');
await shoot(gm, '/players', 'players');
await shoot(player, '/help', 'help');
// Wizard: fresh player with no claim.
try { await api('/users', { username: 'bram', password: 'bram' }, gm.token); } catch {}
const p2 = await login('bram', 'bram');
await api(`/campaigns/${campaign.id}/players`, { username: 'bram' }, gm.token);
await shoot(p2, '/create/1', 'wizard', { full: true });

await browser.close();
gmSock.close(); plSock.close();
process.exit(0);
