import { MAX_HOPE } from '@daggerheart/rules';
import type { RoomEvent } from '@daggerheart/protocol';
import { useMemo, useState } from 'react';

import { DamageDialog } from '../sheet/DamageDialog.js';
import { RollDialog, type RollDialogSpec } from '../sheet/RollDialog.js';
import {
  ArmorSlots,
  CornerBrackets,
  DefenseHex,
  HopeRow,
  LevelShield,
  SegmentTracker,
  ThresholdRibbon,
  TraitPlaque,
} from '../sheet/SheetFurniture.js';
import type { RollEntry } from '../../state/rollLog.js';
import { describeWeaponDamage, label as prettify, selectSheetView, weaponDamage } from '../../state/selectors.js';
import type { DualityRollRequest, SheetState } from '../../state/sheet.js';

interface MapSheetPanelProps {
  sheet: SheetState;
  characterId: string;
  send: (event: RoomEvent) => void;
  sharedLog: readonly RollEntry[] | undefined;
}

interface PendingRoll extends RollDialogSpec {
  damage: { dice: { count: number; die: number }; proficiency: number; modifier: number } | null;
}

type Tab = 'hoja' | 'cartas' | 'bio';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'hoja', label: 'Hoja' },
  { id: 'cartas', label: 'Cartas de dominio' },
  { id: 'bio', label: 'Bio e historia' },
];

/**
 * The compact sheet for the map's floating window: everything you need to
 * fight, in one 640px-tall pane over the map, laid out as the design
 * direction's §05 — shields and plaques in CSS geometry, resources as
 * shaped tracks. Always online (the map only exists inside a joined
 * campaign), so unlike `SheetRoute` this never runs the offline reducer:
 * every action is an intent, and the result arrives through the shared room
 * state and roll log the caller already has.
 */
export function MapSheetPanel({ sheet, characterId, send, sharedLog }: MapSheetPanelProps) {
  const view = useMemo(() => selectSheetView(sheet), [sheet]);
  const character = sheet.character;
  const [pending, setPending] = useState<PendingRoll | null>(null);
  const [showDamage, setShowDamage] = useState(false);
  const [tab, setTab] = useState<Tab>('hoja');

  const forMe = <T extends Record<string, unknown>>(event: T) =>
    ({ ...event, characterId }) as unknown as RoomEvent;

  const experiences = useMemo(
    () => Object.entries(character.experiences).map(([name, modifier]) => ({ name, modifier })),
    [character.experiences],
  );

  const vulnerable = sheet.stressMarked >= character.stressSlots;

  const openTraitRoll = (traitLabel: string, modifier: number) =>
    setPending({ title: `Tirada de ${traitLabel}`, modifiers: modifier, modifierLabel: traitLabel, damage: null });

  const openAttackRoll = (weaponName: string, trait: string, modifier: number, damage: PendingRoll['damage']) =>
    setPending({
      title: `Ataque — ${weaponName}`,
      modifiers: modifier,
      modifierLabel: `Ataque de ${prettify(trait)}`,
      damage,
    });

  const rollLooseDamage = (weaponName: string, damage: NonNullable<PendingRoll['damage']>) =>
    send(forMe({ type: 'rollDamage', label: `${weaponName} — daño`, dice: damage.dice, proficiency: damage.proficiency, modifier: damage.modifier, critical: false }));

  const submitRoll = (request: Omit<DualityRollRequest, 'label'>) => {
    if (pending === null) return;
    send(forMe({ type: 'rollDuality', request: { ...request, label: pending.title } }));
    if (pending.damage !== null) {
      send(
        forMe({
          type: 'rollDamage',
          label: `${pending.title} — daño`,
          dice: pending.damage.dice,
          proficiency: pending.damage.proficiency,
          modifier: pending.damage.modifier,
          critical: false,
        }),
      );
    }
    setPending(null);
  };

  return (
    <div className="sheet-compact">
      <nav className="sheet-tabs" aria-label="Secciones de la hoja">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="sheet-tab"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="sheet-compact-body">
        <CornerBrackets />

        <div className="sheet-identity">
          <div className="sheet-identity-main">
            <span className="sheet-portrait" aria-hidden="true" />
            <div>
              <h2 className="sheet-name">{character.name ?? 'Personaje sin nombre'}</h2>
              <p className="sheet-subtitle">
                {view.heritageLabel} · {view.className}{' '}
                <span className="sheet-subtitle-dim">({view.subclassName})</span>
              </p>
            </div>
          </div>
          <div className="sheet-identity-aside">
            <div className="sheet-conditions">
              <span className="sheet-conditions-label">Condiciones</span>
              {vulnerable ? (
                <span className="condition-chip">Vulnerable</span>
              ) : (
                <span className="sheet-conditions-empty">ninguna activa</span>
              )}
            </div>
            <LevelShield level={character.level} />
          </div>
        </div>

        {tab === 'hoja' ? (
          <>
            <div className="sheet-defense-row">
              <div className="sheet-defense-hexes">
                <DefenseHex value={character.evasion} label="Evasión" />
                <DefenseHex value={character.armorScore} label="Armadura" />
              </div>
              <ArmorSlots
                label="Ranuras de armadura"
                marked={sheet.armorSlotsMarked}
                total={character.armorScore}
                fillLabel="marcadas"
                onMark={() => send(forMe({ type: 'markArmorSlot', amount: 1 }))}
                onClear={() => send(forMe({ type: 'clearArmorSlot', amount: 1 }))}
              />
            </div>

            <div className="trait-plaques">
              {view.traits.map((trait) => (
                <TraitPlaque
                  key={trait.trait}
                  label={trait.label}
                  modifier={trait.modifier}
                  uses={trait.uses}
                  active={pending?.modifierLabel === trait.label}
                  onClick={() => openTraitRoll(trait.label, trait.modifier)}
                />
              ))}
            </div>

            <ThresholdRibbon
              major={character.major}
              severe={character.severe}
              onCalculate={() => setShowDamage(true)}
            />

            <SegmentTracker
              label="Puntos de Vida"
              marked={sheet.hpMarked}
              total={character.hpSlots}
              tone="hp"
              fillLabel="marcados"
              onMark={() => send(forMe({ type: 'markHP', amount: 1 }))}
              onClear={() => send(forMe({ type: 'clearHP', amount: 1 }))}
            />
            <SegmentTracker
              label="Estrés"
              marked={sheet.stressMarked}
              total={character.stressSlots}
              tone="stress"
              fillLabel="marcados"
              note={vulnerable ? 'Vulnerable' : undefined}
              onMark={() => send(forMe({ type: 'markStress', amount: 1 }))}
              onClear={() => send(forMe({ type: 'clearStress', amount: 1 }))}
            />

            <div className="sheet-compact-footer">
              <HopeRow
                label="Esperanza"
                marked={sheet.hope}
                total={MAX_HOPE}
                fillLabel="en reserva"
                onMark={() => send(forMe({ type: 'gainHope', amount: 1 }))}
                onClear={() => send(forMe({ type: 'spendHope', amount: 1 }))}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  setPending({ title: 'Tirada de dualidad', modifiers: 0, modifierLabel: 'Sin rasgo', damage: null })
                }
              >
                Tirar dualidad
              </button>
            </div>

            {[view.primaryWeapon, view.secondaryWeapon].map((weapon, index) =>
              weapon === null ? null : (
                <div className="weapon-strip" key={weapon.id}>
                  <div className="weapon-strip-name">
                    <strong>{weapon.name}</strong>
                    <span className="muted">
                      {prettify(weapon.trait)} · {describeWeaponDamage(weapon, character)}{' '}
                      {prettify(weapon.damageType)} · {index === 0 ? 'primaria' : 'secundaria'}
                    </span>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      onClick={() =>
                        openAttackRoll(
                          weapon.name,
                          weapon.trait,
                          weapon.trait === 'spellcast'
                            ? view.spellcastTrait === null
                              ? 0
                              : character.traits[view.spellcastTrait]
                            : character.traits[weapon.trait],
                          weaponDamage(weapon, character),
                        )
                      }
                    >
                      Atacar
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => rollLooseDamage(weapon.name, weaponDamage(weapon, character))}
                    >
                      Daño
                    </button>
                  </div>
                </div>
              ),
            )}
          </>
        ) : null}

        {tab === 'cartas' ? (
          <div className="domain-card-grid">
            {view.loadout.length === 0 ? (
              <p className="muted">No hay cartas en juego.</p>
            ) : (
              view.loadout.map((card) => (
                <article className="domain-mini" key={card.id} style={{ ['--domain-color' as string]: `var(--c-domain-${card.domain})` }}>
                  <div className="domain-mini-head">
                    <h3>{card.name}</h3>
                    <span className="domain-mini-level">{card.level}</span>
                  </div>
                  <span className="domain-mini-type">
                    {prettify(card.domain)} · {prettify(card.type)}
                  </span>
                  <p className="domain-mini-text">{card.text}</p>
                  <div className="domain-mini-cost">
                    <span className="domain-mini-cost-label">Coste</span>
                    <span className="muted">{card.recallCost} de Estrés al recuperar</span>
                  </div>
                </article>
              ))
            )}
            <p className="muted">{view.vault.length} carta(s) en la Bóveda.</p>
          </div>
        ) : null}

        {tab === 'bio' ? (
          <div className="sheet-bio">
            <dl className="sheet-bio-list">
              <dt>Herencia</dt>
              <dd>{view.heritageLabel}</dd>
              <dt>Comunidad</dt>
              <dd>{view.communityName}</dd>
              <dt>Clase</dt>
              <dd>
                {view.className} · {view.subclassName}
              </dd>
              <dt>Competencia</dt>
              <dd>{character.proficiency}</dd>
            </dl>
            <h3 className="sheet-bio-head">Experiencias</h3>
            {experiences.length === 0 ? (
              <p className="muted">Sin experiencias.</p>
            ) : (
              <ul className="sheet-bio-experiences">
                {experiences.map((experience) => (
                  <li key={experience.name}>
                    {experience.name} <span className="muted">+{experience.modifier}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {sharedLog !== undefined && sharedLog.length > 0 ? (
          <p className="muted sheet-last-roll">Última tirada: {sharedLog[sharedLog.length - 1]?.label}</p>
        ) : null}
      </div>

      {pending !== null ? (
        <RollDialog
          spec={pending}
          experiences={experiences}
          hope={sheet.hope}
          outcome={null}
          onRoll={submitRoll}
          onClose={() => setPending(null)}
        />
      ) : null}

      {showDamage ? (
        <DamageDialog
          armorSlotsAvailable={character.armorScore - sheet.armorSlotsMarked}
          thresholds={character.thresholds}
          onApply={(options) => {
            send(forMe({ type: 'takeDamage', ...options }));
            setShowDamage(false);
          }}
          onClose={() => setShowDamage(false)}
        />
      ) : null}
    </div>
  );
}
