import { createRoomState, type CampaignDetail, type CampaignSummary, type ManagedPlayer } from '@daggerheart/protocol';
import { srd } from '@daggerheart/srd-data';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { GMPanel } from '../src/components/gm/GMPanel.js';
import { setLocale, t } from '../src/i18n/index.js';
import { CampaignPageView } from '../src/routes/CampaignPageRoute.js';
import { CampaignsRoute } from '../src/routes/CampaignsRoute.js';
import { GmHomeRoute } from '../src/routes/GmHomeRoute.js';
import { MyCampaignsRoute } from '../src/routes/MyCampaignsRoute.js';
import { PlayersView } from '../src/routes/PlayersRoute.js';

/** Markup-level checks for the GM home pieces, as `render.test.tsx` does for the rest. */
const render = (element: JSX.Element, path = '/') =>
  renderToStaticMarkup(<StaticRouter location={path}>{element}</StaticRouter>);

afterEach(() => setLocale('es'));

const GM = 'u-gm';
const summary = (id: string, status: CampaignSummary['status'], ownerId = GM): CampaignSummary => ({
  id,
  name: `Campaña ${id}`,
  ownerId,
  ownerUsername: 'gm',
  memberIds: [],
  invitedIds: [],
  status,
});
const noop = () => {};

describe('GM home', () => {
  it('offers two doors: my campaigns and my players', () => {
    const html = render(<GmHomeRoute username="gm" activeCount={2} />);
    expect(html).toContain(t('gmHome.campaigns'));
    expect(html).toContain(t('gmHome.players'));
    expect(html).toContain('href="/campaigns"');
    expect(html).toContain('href="/players"');
    expect(html).toContain('home-door--gm-campaigns');
    expect(html).toContain('home-door--gm-players');
  });
});

describe('GM campaigns list', () => {
  it('counts each status in its tab and lists the open tab only', () => {
    const html = render(
      <CampaignsRoute
        accountId={GM}
        campaigns={[summary('a', 'active'), summary('b', 'paused'), summary('c', 'finished'), summary('d', 'finished')]}
        initialTab="finished"
        onCreate={noop}
        onEnter={noop}
        pending={false}
        tunnelUrl={null}
        tunnelLoading={false}
        onGenerateTunnel={noop}
      />,
    );
    expect(html).toContain(t('gmCampaigns.tab.active', { count: 1 }));
    expect(html).toContain(t('gmCampaigns.tab.paused', { count: 1 }));
    expect(html).toContain(t('gmCampaigns.tab.finished', { count: 2 }));
    expect(html).toContain('Campaña c');
    expect(html).toContain('Campaña d');
    expect(html).not.toContain('Campaña a');
    expect(html).toContain('href="/campaigns/c"');
  });
});

describe("a player's campaigns", () => {
  it('shows a paused campaign with its badge and no way in', () => {
    const html = render(
      <MyCampaignsRoute
        accountId="u-ana"
        campaigns={[summary('p', 'paused')]}
        invited={[]}
        characters={[]}
        pending={false}
        onAnswer={noop}
        onEnter={noop}
        onRefresh={noop}
      />,
    );
    expect(html).toContain(t('status.paused'));
    expect(html).toContain(t('myCampaigns.pausedNote'));
    expect(html).not.toContain(`>${t('campaigns.join')}<`);
  });

  it('an active one can be entered', () => {
    const html = render(
      <MyCampaignsRoute
        accountId="u-ana"
        campaigns={[summary('a', 'active')]}
        invited={[]}
        characters={[]}
        pending={false}
        onAnswer={noop}
        onEnter={noop}
        onRefresh={noop}
      />,
    );
    expect(html).toContain(`>${t('campaigns.join')}<`);
  });
});

const detail = (): CampaignDetail => ({
  campaign: { ...summary('a', 'paused'), memberIds: ['u-ana'], invitedIds: ['u-beto'] },
  members: [{ id: 'u-ana', username: 'ana', character: { name: 'Brunilda', classId: 'guardian', level: 2, transformation: null } }],
  invited: [{ id: 'u-beto', username: 'beto' }],
  story: { pitch: 'Un robo en Puerto Velo.', body: 'Sesión 1: la bóveda.' },
  prepAdversaries: [{ id: 'p-1', adversaryId: 'acid-burrower', quantity: 2, note: 'en las cloacas' }],
  journal: [{ id: 'j-1', title: 'El contacto', body: '', image: null, shared: 'gm' }],
});

describe('GM campaign page', () => {
  const page = (tab: 'story' | 'notes' | 'monsters' | 'players') =>
    render(
      <CampaignPageView
        detail={detail()}
        players={[]}
        tab={tab}
        onTab={noop}
        authToken={null}
        sendPrep={async () => true}
        onUpdate={noop}
        onEnter={noop}
        onInvite={noop}
        onCancelInvite={noop}
        onRemove={noop}
      />,
    );

  it('heads with the name, the status and a way to the table, on every tab', () => {
    const html = page('story');
    expect(html).toContain('Campaña a');
    expect(html).toContain(t('gmCampaigns.enterTable'));
    expect(html).toContain(t('campaignPage.notActiveHint'));
    expect(html).toContain(t('campaignPage.tab.monsters'));
  });

  it('Historia shows the pitch and the story', () => {
    const html = page('story');
    expect(html).toContain('Un robo en Puerto Velo.');
    expect(html).toContain('Sesión 1: la bóveda.');
  });

  it('Notas is the journal', () => {
    expect(page('notes')).toContain('El contacto');
  });

  it('Monstruos lists the prepared adversaries with quantity and note', () => {
    const html = page('monsters');
    const name = srd().adversaries.find((a) => a.id === 'acid-burrower')?.name ?? '';
    expect(html).toContain(name);
    expect(html).toContain('en las cloacas');
    expect(html).toContain(t('monsters.prepared'));
  });

  it('Jugadores lists members with their character, and pending invites', () => {
    const html = page('players');
    expect(html).toContain('ana');
    expect(html).toContain('Brunilda');
    expect(html).toContain('beto');
    expect(html).toContain(t('campaigns.cancelInvite'));
    expect(html).toContain(t('members.remove'));
  });
});

describe('GM panel prep list', () => {
  it('shows what was prepared, with a one-click add to the encounter', () => {
    const room = {
      ...createRoomState('c-1', { id: GM, name: 'GM', connected: true }),
      prepAdversaries: [{ id: 'p-1', adversaryId: 'acid-burrower', quantity: 3, note: 'jefe' }],
    };
    const html = render(<GMPanel room={room} campaignName="Martes" authToken={null} send={noop} />);
    expect(html).toContain(t('gm.prep.title'));
    expect(html).toContain(t('gm.prep.add'));
    expect(html).toContain(t('gm.prep.count', { count: 3 }));
    expect(html).toContain('jefe');
  });
});

describe('Mis jugadores', () => {
  it('lists each player with their campaigns, invitations and last sign-in', () => {
    const players: ManagedPlayer[] = [
      {
        id: 'u-ana',
        username: 'ana',
        mustChangePassword: false,
        campaigns: [{ id: 'a', name: 'Martes', status: 'active' }],
        invitedTo: [{ id: 'b', name: 'Viernes' }],
        lastLoginAt: null,
      },
    ];
    const html = render(
      <PlayersView
        players={players}
        campaigns={[summary('a', 'active'), summary('b', 'active'), summary('c', 'active')]}
        accountId={GM}
        loading={false}
        onCreate={async () => true}
        onReset={async () => true}
        onInvite={async () => true}
      />,
    );
    expect(html).toContain('ana');
    expect(html).toContain('Martes');
    expect(html).toContain('Viernes');
    expect(html).toContain(t('players.never'));
    expect(html).toContain(t('players.resetPassword'));
    // Only the campaign she is neither in nor invited to is offered.
    expect(html).toContain('Campaña c');
    expect(html).not.toContain('>Campaña a<');
  });
});
