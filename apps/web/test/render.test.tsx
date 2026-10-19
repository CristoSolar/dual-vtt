import { createMapState, type RoomState } from '@daggerheart/protocol';
import { scriptedRng } from '@daggerheart/rules';
import { srd } from '@daggerheart/srd-data';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudioPlayer } from '../src/components/audio/AudioPlayer.js';
import { EntryDetail } from '../src/components/help/details.js';
import { COLLECTIONS } from '../src/components/help/Compendium.js';
import { GMPanel } from '../src/components/gm/GMPanel.js';
import { ConfirmDialog } from '../src/components/ConfirmDialog.js';
import { GuideDialog } from '../src/components/GuideDialog.js';
import { PartyStrip } from '../src/components/sheet/PartyStrip.js';
import { RollDialog } from '../src/components/sheet/RollDialog.js';
import { RollLogPanel } from '../src/components/sheet/RollLogPanel.js';
import { Toast } from '../src/components/Toast.js';
import { MapSheetPanel } from '../src/components/map/MapSheetPanel.js';
import { Hotbar } from '../src/components/sheet/Hotbar.js';
import { JournalPanel } from '../src/components/journal/JournalPanel.js';
import { setLocale, t } from '../src/i18n/index.js';
import { HelpRoute, parseHelpHash } from '../src/routes/HelpRoute.js';
import { WizardRoute } from '../src/routes/WizardRoute.js';
import { SheetRoute } from '../src/routes/SheetRoute.js';
import {
  createSheet,
  makeDualityRoll,
  takeDamage,
  type SheetEffect,
  type SheetState,
} from '../src/state/sheet.js';
import { emptyHotbar, setSlot } from '../src/state/hotbar.js';
import { saveCreation } from '../src/state/storage.js';
import { buildCharacter, buildCreationState, fakeStorage } from './helpers.js';

/**
 * Renders the real component tree to markup. This catches crashes that typechecking
 * can't — a bad hook order, an undefined field read during render — without needing
 * a DOM or any test-library dependency.
 */
const render = (element: JSX.Element, path = '/') =>
  renderToStaticMarkup(<StaticRouter location={path}>{element}</StaticRouter>);

afterEach(() => setLocale('es'));

const noopUpdate = (
  transition: (sheet: SheetState) => { sheet: SheetState; effect: SheetEffect },
): SheetEffect | null => transition(createSheet(buildCharacter())).effect;

describe('sheet renders', () => {
  it('shows a populated sheet for a finished character', () => {
    const sheet = createSheet(buildCharacter('bard'));
    const html = render(<SheetRoute sheet={sheet} update={noopUpdate} rng={() => 0.5} />);

    expect(html).toContain('Test Character');
    expect(html).toContain('Bard');
    for (const heading of [
      t('sheet.route.traitsTitle'),
      t('sheet.route.defensesTitle'),
      t('sheet.route.hp'),
      t('sheet.route.stress'),
      t('sheet.roll.hopeLabel'),
      t('sheet.route.armorSlots'),
      t('sheet.route.gold'),
      t('sheet.route.weaponsArmorTitle'),
      t('sheet.route.experiencesTitle'),
      t('sheet.route.classFeaturesTitle'),
      t('sheet.route.inventoryTitle'),
      t('sheet.loadout.title').split('{')[0]?.trim() ?? '',
      t('sheet.loadout.vaultTitle'),
      t('sheet.log.title'),
    ]) {
      expect(html, heading).toContain(heading);
    }

    expect(html).toContain(`>${sheet.character.evasion}<`);
    expect(html).toContain(`>${sheet.character.major}<`);
    expect(html).toContain(`>${sheet.character.severe}<`);
    expect(html).toContain('Blacksmith');
  });

  it('renders every class without crashing', () => {
    for (const classId of [
      'bard',
      'druid',
      'guardian',
      'ranger',
      'rogue',
      'seraph',
      'sorcerer',
      'warrior',
      'wizard',
    ] as const) {
      const sheet = createSheet(buildCharacter(classId));
      expect(() =>
        render(<SheetRoute sheet={sheet} update={noopUpdate} rng={() => 0.5} />),
      ).not.toThrow();
    }
  });

  it('offers a Spellcast roll only to a subclass that has the trait', () => {
    const caster = createSheet(buildCharacter('wizard'));
    const nonCaster = createSheet(buildCharacter('guardian'));

    expect(render(<SheetRoute sheet={caster} update={noopUpdate} rng={() => 0.5} />)).toContain(
      t('sheet.route.spellRollButton'),
    );
    expect(
      render(<SheetRoute sheet={nonCaster} update={noopUpdate} rng={() => 0.5} />),
    ).not.toContain(t('sheet.route.spellRollButton'));
  });

  it('marks a Vulnerable character on the sheet', () => {
    const sheet = createSheet(buildCharacter());
    const stressed: SheetState = { ...sheet, stressMarked: sheet.character.stressSlots };
    expect(render(<SheetRoute sheet={stressed} update={noopUpdate} rng={() => 0.5} />)).toContain(
      'Vulnerable',
    );
  });
});

describe('compact sheet renders', () => {
  it('shows the combat furniture: level, defences, traits, thresholds and tracks', () => {
    const sheet = createSheet(buildCharacter('warrior'));
    const html = render(
      <MapSheetPanel sheet={sheet} characterId="pc1" send={() => {}} sharedLog={[]} />,
    );

    // The level shield, the two defence hexagons and the threshold ribbon are
    // the pieces that make it read as a sheet rather than a form.
    expect(html).toContain(t('sheet.furniture.level'));
    expect(html).toContain(t('sheet.route.evasion'));
    expect(html).toContain(t('sheet.route.armor'));
    expect(html).toContain(t('sheet.furniture.thresholdsTitle'));
    expect(html).toContain(`>${sheet.character.major}<`);
    expect(html).toContain(`>${sheet.character.severe}<`);

    // Every trait plaque carries its name and its three SRD uses.
    expect(html).toContain(t('trait.instinct'));
    expect(html).toContain(t('trait.instinctUses').split(' · ')[0]);
    expect(html).toContain(t('trait.instinctUses').split(' · ')[2]);

    for (const track of [
      t('sheet.route.hp'),
      t('sheet.route.stress'),
      t('sheet.roll.hopeLabel'),
      t('sheet.route.armorSlots'),
    ]) {
      expect(html, track).toContain(track);
    }
  });

  it('marks Vulnerable as a condition chip once Stress is full', () => {
    const sheet = createSheet(buildCharacter());
    const stressed: SheetState = { ...sheet, stressMarked: sheet.character.stressSlots };

    expect(render(<MapSheetPanel sheet={sheet} characterId="pc1" send={() => {}} sharedLog={[]} />)).toContain(
      t('map.sheet.noConditions'),
    );
    expect(
      render(<MapSheetPanel sheet={stressed} characterId="pc1" send={() => {}} sharedLog={[]} />),
    ).toContain(t('sheet.route.vulnerable'));
  });
});

describe('wizard renders', () => {
  const storage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  };

  const wizardAt = (path: string, store = storage()) =>
    renderToStaticMarkup(
      <StaticRouter location={path}>
        <Routes>
          <Route
            path="/create/:step"
            element={
              <WizardRoute
                storage={store}
                campaignId="campaign-1"
                onClaim={() => {}}
                onFinish={() => {}}
                claimed={false}
                error={null}
              />
            }
          />
        </Routes>
      </StaticRouter>,
    );

  it('lists class options sourced from the SRD data, not hardcoded', () => {
    const html = wizardAt('/create/1');
    for (const characterClass of srd().classes) {
      expect(html, characterClass.name).toContain(characterClass.name);
    }
    expect(html).toContain(t('wizard.stepHeading', { step: 1, title: t('wizard.stepTitle.1') }));
    expect(html).toContain(t('wizard.stepTitle.1'));
  });

  it('disables Next until the step validates', () => {
    const html = wizardAt('/create/1');
    const nextLabel = t('wizard.next').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${nextLabel}`));
  });

  it('resumes a saved creation at its step with choices intact', () => {
    const store = storage();
    saveCreation(store, 'campaign-1', buildCreationState('sorcerer'));
    const html = wizardAt('/create/8', store);

    expect(html).toContain(t('wizard.stepHeading', { step: 8, title: t('wizard.stepTitle.8') }));
    // A Sorcerer's domains are Arcana and Midnight, so only those cards are offered.
    expect(html).toContain('Arcana');
    expect(html).toContain('Midnight');
    expect(html).not.toContain('Codex');
  });
});

describe('offline sheet reducers', () => {
  it('mutates a sheet with no server and no campaign props', () => {
    // No characterId/send: the sheet must fall back to local pure reducers.
    const sheet = createSheet(buildCharacter('bard'));
    const html = render(<SheetRoute sheet={sheet} update={noopUpdate} rng={() => 0.5} />);
    expect(html).toContain('Test Character');

    const damaged = takeDamage(sheet, {
      incoming: sheet.character.thresholds.severe,
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 0,
    });
    expect(damaged.sheet.hpMarked).toBe(3);

    const rolled = makeDualityRoll(
      sheet,
      {
        label: 'Offline roll',
        modifiers: 0,
        difficulty: 10,
        advantage: 0,
        disadvantage: 0,
        experiences: [],
      },
      scriptedRng([6, 6]),
    );
    expect(rolled.outcome?.result.outcome).toBe('criticalSuccess');
  });
});

/** A room with one seated player, their sheet, a countdown and an adversary. */
function gmRoom(): RoomState {
  const sheet = createSheet(buildCharacter('seraph'));
  return {
    id: 'c-abc234',
    gm: { id: 'gm-1', name: 'The GM', connected: true },
    players: [{ id: 'p1', name: 'Alice', connected: false, characterId: 'pc1' }],
    characters: { pc1: sheet },
    fear: 4,
    spotlight: 'p1',
    countdowns: [],
    adversaryInstances: [],
    activeEnvironment: null,
    rest: null,
    consecutiveShortRests: 0,
    groupAction: null,
    tagTeam: null,
    spotlightTokens: null,
    adversaryPools: [],
    map: createMapState(),
    targets: {},
    journal: [],
    audio: { tracks: [], playing: null },
    rollLog: [],
    privateLog: [],
  };
}

describe('transformations', () => {
  it('lists every transformation in the compendium, with its questions', () => {
    const transformation = srd().transformations[0];
    if (transformation === undefined) throw new Error('no transformations in the SRD data');
    const html = render(<HelpRoute />, `/help#compendium/transformations/${transformation.id}`);
    expect(html).toContain(transformation.name);
    expect(html).toContain(t('sheet.transformation.questions'));
  });
});

describe('the GM rolling for an adversary', () => {
  it('offers an attack and a damage roll on each adversary card', () => {
    const adversary = srd().adversaries[0];
    if (adversary === undefined) throw new Error('no adversaries in the SRD data');
    const room: RoomState = {
      ...gmRoom(),
      adversaryInstances: [
        {
          instanceId: 'a1',
          adversaryId: adversary.id,
          name: 'Guard A',
          hpMarked: 0,
          stressMarked: 0,
          usedFeatures: [],
        },
      ],
    };
    const html = render(<GMPanel room={room} campaignName="A" authToken={null} send={() => {}} />, '/gm');
    expect(html).toContain(t('gm.adversaries.rollAttack'));
    expect(html).toContain(t('gm.adversaries.noTarget'));
    // The seated player is offered as a target.
    expect(html).toContain('Alice');
  });
});

describe('downtime', () => {
  it('offers the GM a rest, and says when the party owes a long one', () => {
    const base = gmRoom();
    expect(render(<GMPanel room={base} campaignName="A" authToken={null} send={() => {}} />, '/gm')).toContain(
      t('gm.downtime.beginShort'),
    );

    const owed = { ...base, consecutiveShortRests: 3 };
    const html = render(<GMPanel room={owed} campaignName="A" authToken={null} send={() => {}} />, '/gm');
    expect(html).toContain(t('gm.downtime.owesLong'));
  });

  it('shows the moves left once a rest is open', () => {
    const resting = {
      ...gmRoom(),
      rest: { kind: 'short' as const, movesLeft: { pc1: 2 } },
    };
    const html = render(<GMPanel room={resting} campaignName="A" authToken={null} send={() => {}} />, '/gm');
    expect(html).toContain(t('gm.downtime.end'));
  });
});

describe('playlist', () => {
  const audio: RoomState['audio'] = {
    tracks: [{ id: 't-1', name: 'Tavern Rain', url: '/uploads/a.ogg' }],
    playing: { trackId: 't-1', startedAt: 0, loop: true, volume: 0.5 },
  };

  it('lists the GM’s tracks with a way to stop the one playing', () => {
    const room = { ...gmRoom(), audio };
    const html = render(<GMPanel room={room} campaignName="A" authToken={null} send={() => {}} />);
    expect(html).toContain(t('gm.playlist.title'));
    expect(html).toContain('Tavern Rain');
    expect(html).toContain(t('gm.playlist.stop'));
    expect(html).toContain(t('gm.playlist.upload'));
  });

  it('shows every listener what is playing, without the unlock button until a refusal', () => {
    vi.stubGlobal('window', { localStorage: fakeStorage() });
    try {
      const html = render(<AudioPlayer audio={audio} />);
      expect(html).toContain(t('audio.nowPlaying', { name: 'Tavern Rain' }));
      expect(html).toContain(t('audio.volume'));
      expect(html).not.toContain(t('audio.enable'));
      expect(render(<AudioPlayer audio={{ ...audio, playing: null }} />)).not.toContain(
        'Tavern Rain',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('GM panel renders', () => {
  it('shows Fear, party, countdowns, adversaries, environment, presence and log', () => {
    const sheet = createSheet(buildCharacter('seraph'));
    const room: RoomState = {
      id: 'c-abc234',
      gm: { id: 'gm-1', name: 'The GM', connected: true },
      players: [{ id: 'p1', name: 'Alice', connected: false, characterId: 'pc1' }],
      characters: { pc1: sheet },
      fear: 4,
      spotlight: 'p1',
      countdowns: [
        {
          id: 'c1',
          name: 'The Siege',
          kind: 'consequence',
          value: 3,
          startingValue: 5,
          loop: 'none',
          triggered: false,
        },
      ],
      adversaryInstances: [
        {
          instanceId: 'a1',
          adversaryId: 'courtier',
          name: 'Courtier',
          hpMarked: 1,
          stressMarked: 0,
          usedFeatures: [],
        },
      ],
      activeEnvironment: null,
      rest: null,
      consecutiveShortRests: 0,
      groupAction: null,
      tagTeam: null,
      spotlightTokens: null,
      adversaryPools: [],
      map: createMapState(),
      targets: {},
      journal: [],
      audio: { tracks: [], playing: null },
      privateLog: [],
      rollLog: [
        {
          kind: 'duality',
          id: 'r1',
          at: 0,
          by: 'Alice',
          label: 'Agility Roll',
          roll: {
            hope: 7,
            fear: 3,
            total: 10,
            modifiers: 0,
            critical: false,
            withHope: true,
            advantageRoll: null,
            disadvantageRoll: null,
          },
          difficulty: 10,
          outcome: 'successHope',
          experiences: [],
          reaction: false,
          target: null,
        },
      ],
    };

    const html = render(<GMPanel room={room} campaignName="Grupo Martes" authToken={null} send={() => {}} />);

    expect(html).toContain(t('app.gmPanel'));
    expect(html).toContain('Grupo Martes');
    expect(html).toContain(t('sheet.roll.fearLabel'));
    expect(html).toContain('The Siege');
    expect(html).toContain('Courtier');
    expect(html).toContain(t('gm.environment.title'));
    expect(html).toContain(t('gm.presence.title'));
    expect(html).toContain(t('gm.presence.disconnected'));
    expect(html).toContain('Alice');
    expect(html).toContain(t('roll.outcome.successHope'));
  });
});

describe('parseHelpHash', () => {
  it('parses each shape into a tab and a rest path', () => {
    expect(parseHelpHash('')).toEqual({ tab: 'app', rest: [] });
    expect(parseHelpHash('#')).toEqual({ tab: 'app', rest: [] });
    expect(parseHelpHash('#compendium')).toEqual({ tab: 'compendium', rest: [] });
    expect(parseHelpHash('#compendium/')).toEqual({ tab: 'compendium', rest: [''] });
    expect(parseHelpHash('#compendium/adversaries/')).toEqual({
      tab: 'compendium',
      rest: ['adversaries', ''],
    });
    expect(parseHelpHash('#nope')).toEqual({ tab: 'app', rest: [] });
  });
});

describe('GuideDialog', () => {
  it('renders the first GM step', () => {
    const html = renderToStaticMarkup(<GuideDialog role="gm" onClose={() => {}} />);
    expect(html).toContain(t('guide.gm.1.title'));
  });
});

describe('HelpRoute', () => {
  it('renders the three tabs and the app-guide sections', () => {
    const html = render(<HelpRoute />, '/help#app');
    expect(html).toContain(t('help.tab.app'));
    expect(html).toContain(t('help.tab.rules'));
    expect(html).toContain(t('help.tab.compendium'));
    expect(html).toContain(t('help.app.start.title'));
    expect(html).toContain(t('help.app.faq.title'));
  });

  it('renders the rules primer sections and the SRD attribution', () => {
    const html = render(<HelpRoute />, '/help#rules');
    expect(html).toContain(t('help.rules.duality.title'));
    expect(html).toContain(t('help.rules.levelUp.title'));
    expect(html).toContain(t('brand.compatibleShort'));
  });

  it('carries the licence notice the DPCGL asks for, with its links', () => {
    const html = render(<HelpRoute />, '/help#about');
    expect(html).toContain(t('brand.notice'));
    expect(html).toContain(t('brand.modifications'));
    expect(html).toContain(t('brand.notAffiliated'));
    expect(html).toContain('darringtonpress.com/license');
    expect(html).toContain('images/brand/daggerheart-compatible.svg');
  });
});

describe('Compendium', () => {
  it('deep-links to an adversary and follows the locale', () => {
    setLocale('es');
    expect(render(<HelpRoute />, '/help#compendium/adversaries/acid-burrower')).toContain('Excavador Ácido');
    setLocale('en');
    expect(render(<HelpRoute />, '/help#compendium/adversaries/acid-burrower')).toContain('Acid Burrower');
  });

  it('falls back to the default collection on an unknown deep link', () => {
    setLocale('es');
    const html = render(<HelpRoute />, '/help#compendium/nope/nothing');
    expect(html).toMatch(/<option[^>]*value="classes"[^>]*selected=""[^>]*>/);
    expect(html).toContain('Bardo');
    expect(html).not.toContain('Excavador');
  });

  it('shows the pick prompt, not empty/notFound, for a collection with a trailing slash and no id', () => {
    const html = render(<HelpRoute />, '/help#compendium/adversaries/');
    expect(html).toContain(t('compendium.pick'));
    expect(html).not.toContain(t('compendium.empty'));
    expect(html).not.toContain(t('compendium.notFound'));
  });

  it('renders every entry of every collection without crashing', () => {
    for (const collection of COLLECTIONS) {
      for (const entry of srd()[collection]) {
        expect(() =>
          renderToStaticMarkup(
            <EntryDetail collection={collection} id={entry.id} onNavigate={() => {}} />,
          ),
        ).not.toThrow();
      }
    }
  });
});

describe('usability pieces', () => {
  it('a confirmation states what will happen and offers a way out', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        title="Leave"
        body="You will be disconnected."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('You will be disconnected.');
    expect(html).toContain(t('common.cancel'));
    expect(html).toContain('aria-labelledby');
  });

  it('a rejection toast is announced assertively, a notice politely', () => {
    const rejection = renderToStaticMarkup(
      <Toast tone="alert" message="No Hope left." onDismiss={() => {}} />,
    );
    expect(rejection).toContain('role="alert"');
    expect(rejection).toContain('aria-live="assertive"');

    const notice = renderToStaticMarkup(<Toast message="Rolled a 12." onDismiss={() => {}} />);
    expect(notice).toContain('role="status"');
  });

  it('the party strip shows the Fear pool and each character\'s tracks', () => {
    const sheet = createSheet(buildCharacter());
    const html = renderToStaticMarkup(
      <PartyStrip
        members={[{ id: 'pc1', name: 'Alex', sheet }]}
        characterId="pc1"
        fear={4}
        spotlit
      />,
    );
    expect(html).toContain(t('sheet.party.fear', { fear: 4, max: 12 }));
    expect(html).toContain(t('sheet.party.yourTurn'));
    expect(html).toContain(String(sheet.character.hpSlots));
  });
});

describe('chat and private entries', () => {
  const line = (id: string, at: number, text: string) =>
    ({ kind: 'message', id, at, by: 'Alice', byId: 'p1', text }) as const;

  it('the log shows a message with its author and text, and labels a private entry', () => {
    const html = render(
      <RollLogPanel
        entries={[line('m1', 10, 'Abro la puerta')]}
        privateEntries={[{ audience: ['p1'], entry: line('m2', 20, 'Solo para ti') }]}
        chat={{ gmId: 'gm-1', players: [{ id: 'p2', name: 'Bruno' }], onSend: () => {} }}
      />,
    );
    expect(html).toContain('Alice');
    expect(html).toContain('Abro la puerta');
    expect(html).toContain('Solo para ti');
    expect(html.split(t('log.private')).length - 1).toBe(1);
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('Bruno');
    expect(html).toContain(t('sheet.log.filter.message'));
  });

  it('the GM log shows whispers and offers private rolls', () => {
    const room = gmRoom();
    room.privateLog = [{ audience: ['p1'], entry: line('m1', 10, 'Un secreto') }];
    room.adversaryInstances = [
      { instanceId: 'a1', adversaryId: 'courtier', name: 'Courtier', hpMarked: 0, stressMarked: 0, usedFeatures: [] },
    ];
    const html = render(<GMPanel room={room} campaignName="Grupo" authToken={null} send={() => {}} />);
    expect(html).toContain('Un secreto');
    expect(html).toContain(t('log.private'));
    expect(html).toContain(t('roll.privateToggle'));
  });

  it('the roll dialog offers a private roll only when asked to', () => {
    const spec = { title: 'Agility Roll', modifiers: 1, modifierLabel: 'Agility' };
    const props = { spec, experiences: [], hope: 2, outcome: null, onRoll: () => {}, onClose: () => {} };
    expect(renderToStaticMarkup(<RollDialog {...props} canRollPrivately />)).toContain(
      t('roll.privateToggle'),
    );
    expect(renderToStaticMarkup(<RollDialog {...props} />)).not.toContain(t('roll.privateToggle'));
  });
});

describe('hotbar', () => {
  it('names a trait slot and labels an empty one by its number', () => {
    const sheet = createSheet(buildCharacter('bard'));
    const bar = setSlot(emptyHotbar(), 0, { kind: 'trait', trait: 'agility' });
    const html = renderToStaticMarkup(
      <Hotbar bar={bar} sheet={sheet} onAssign={() => undefined} onUse={() => undefined} />,
    );

    expect(html).toContain(t('trait.agility'));
    expect(html).toContain('aria-label="Espacio vacío 2"');
    expect(html).toContain('aria-label="Espacio vacío 10"');
  });
});

describe('journal panel', () => {
  const entry = {
    id: 'j-1',
    title: 'La posada del cuervo',
    body: 'Huele a humo.',
    image: null,
    shared: 'all' as const,
  };
  const props = {
    journal: [entry],
    openId: 'j-1',
    onOpen: () => undefined,
    send: () => undefined,
    authToken: null,
    notes: [],
  };

  it('lets the GM edit and share an entry', () => {
    const html = renderToStaticMarkup(<JournalPanel {...props} isGameMaster />);
    expect(html).toContain('La posada del cuervo');
    expect(html).toContain(t('journal.edit'));
    expect(html).toContain(t('journal.hideFromPlayers'));
  });

  it('shows a player the entry with no edit button', () => {
    const html = renderToStaticMarkup(<JournalPanel {...props} isGameMaster={false} />);
    expect(html).toContain('Huele a humo.');
    expect(html).not.toContain(t('journal.edit'));
    expect(html).not.toContain(t('journal.showToPlayers'));
    expect(html).not.toContain(t('journal.new'));
  });
});
