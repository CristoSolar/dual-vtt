import { createMapState, type RoomState } from '@daggerheart/protocol';
import { scriptedRng } from '@daggerheart/rules';
import { classes } from '@daggerheart/srd-data';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';

import { GMPanel } from '../src/components/gm/GMPanel.js';
import { MapSheetPanel } from '../src/components/map/MapSheetPanel.js';
import { WizardRoute } from '../src/routes/WizardRoute.js';
import { SheetRoute } from '../src/routes/SheetRoute.js';
import {
  createSheet,
  makeDualityRoll,
  takeDamage,
  type SheetEffect,
  type SheetState,
} from '../src/state/sheet.js';
import { saveCreation } from '../src/state/storage.js';
import { buildCharacter, buildCreationState } from './helpers.js';

/**
 * Renders the real component tree to markup. This catches crashes that typechecking
 * can't — a bad hook order, an undefined field read during render — without needing
 * a DOM or any test-library dependency.
 */
const render = (element: JSX.Element, path = '/') =>
  renderToStaticMarkup(<StaticRouter location={path}>{element}</StaticRouter>);

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
      'Rasgos',
      'Defensas',
      'Puntos de Vida',
      'Estrés',
      'Esperanza',
      'Ranuras de Armadura',
      'Oro',
      'Armas y armadura activas',
      'Experiencias',
      'Rasgos de clase',
      'Inventario',
      'Cartas activas',
      'Bóveda',
      'Registro de tiradas',
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
      'Tirada de Conjuro',
    );
    expect(
      render(<SheetRoute sheet={nonCaster} update={noopUpdate} rng={() => 0.5} />),
    ).not.toContain('Tirada de Conjuro');
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
    expect(html).toContain('Nivel');
    expect(html).toContain('Evasión');
    expect(html).toContain('Armadura');
    expect(html).toContain('Umbrales de daño');
    expect(html).toContain(`>${sheet.character.major}<`);
    expect(html).toContain(`>${sheet.character.severe}<`);

    // Every trait plaque carries its name and its three SRD uses.
    expect(html).toContain('Instinto');
    expect(html).toContain('Percibir');
    expect(html).toContain('Rastrear');

    for (const track of ['Puntos de Vida', 'Estrés', 'Esperanza', 'Ranuras de armadura']) {
      expect(html, track).toContain(track);
    }
  });

  it('marks Vulnerable as a condition chip once Stress is full', () => {
    const sheet = createSheet(buildCharacter());
    const stressed: SheetState = { ...sheet, stressMarked: sheet.character.stressSlots };

    expect(render(<MapSheetPanel sheet={sheet} characterId="pc1" send={() => {}} sharedLog={[]} />)).toContain(
      'ninguna activa',
    );
    expect(
      render(<MapSheetPanel sheet={stressed} characterId="pc1" send={() => {}} sharedLog={[]} />),
    ).toContain('Vulnerable');
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
    for (const characterClass of classes) {
      expect(html, characterClass.name).toContain(characterClass.name);
    }
    expect(html).toContain('Paso 1');
    expect(html).toContain('Clase y Subclase');
  });

  it('disables Next until the step validates', () => {
    const html = wizardAt('/create/1');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Siguiente/);
  });

  it('resumes a saved creation at its step with choices intact', () => {
    const store = storage();
    saveCreation(store, 'campaign-1', buildCreationState('sorcerer'));
    const html = wizardAt('/create/8', store);

    expect(html).toContain('Paso 8');
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
        { instanceId: 'a1', adversaryId: 'courtier', name: 'Courtier', hpMarked: 1, stressMarked: 0 },
      ],
      activeEnvironment: null,
      map: createMapState(),
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
        },
      ],
    };

    const html = render(<GMPanel room={room} campaignName="Grupo Martes" send={() => {}} />);

    expect(html).toContain('Panel del DJ');
    expect(html).toContain('Grupo Martes');
    expect(html).toContain('Miedo');
    expect(html).toContain('The Siege');
    expect(html).toContain('Courtier');
    expect(html).toContain('Entorno');
    expect(html).toContain('En la mesa');
    expect(html).toContain('desconectado');
    expect(html).toContain('Alice');
    expect(html).toContain('Success with Hope');
  });
});
