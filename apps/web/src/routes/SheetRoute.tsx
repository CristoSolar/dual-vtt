import { MAX_HOPE, type Advancement, type Rng } from '@daggerheart/rules';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { DamageDialog } from '../components/sheet/DamageDialog.js';
import { DeathMoveDialog } from '../components/sheet/DeathMoveDialog.js';
import { LevelUpDialog } from '../components/sheet/LevelUpDialog.js';
import { LoadoutPanel } from '../components/sheet/LoadoutPanel.js';
import { PrintableSheet } from '../components/sheet/PrintableSheet.js';
import { RollDialog, type RollDialogSpec } from '../components/sheet/RollDialog.js';
import { RollLogPanel } from '../components/sheet/RollLogPanel.js';
import { SectionHead } from '../components/SectionHead.js';
import { Toast } from '../components/Toast.js';
import { Tracker } from '../components/Tracker.js';
import type { RoomEvent } from '@daggerheart/protocol';

import { appendRoll, type RollEntry } from '../state/rollLog.js';
import {
  describeWeaponDamage,
  label as prettify,
  recallCostOf,
  selectSheetView,
  weaponDamage,
} from '../state/selectors.js';
import {
  applyLevelUp,
  clearSheetArmorSlot,
  clearSheetHP,
  clearSheetStress,
  gainSheetGold,
  gainSheetHope,
  isVulnerable,
  makeDamageRoll,
  makeDualityRoll,
  markSheetArmorSlot,
  markSheetHP,
  markSheetStress,
  recallFromVault,
  sendToVault,
  spendSheetGold,
  spendSheetHope,
  takeDamage,
  type DualityRollOutcome,
  type SheetEffect,
  type SheetState,
  type TakeDamageOptions,
} from '../state/sheet.js';

interface SheetRouteProps {
  sheet: SheetState;
  update: (transition: (sheet: SheetState) => { sheet: SheetState; effect: SheetEffect }) => SheetEffect | null;
  rng: Rng;
  /**
   * Present only in a campaign. When set, mutations are sent to the server as
   * intents and the sheet re-renders from the broadcast, instead of being applied
   * locally. The rules are identical either way — only who runs them changes.
   */
  characterId?: string;
  send?: (event: RoomEvent) => void;
  sharedLog?: readonly RollEntry[] | undefined;
}

/** A pending roll: which button opened the dialog, and its resolved modifier. */
interface PendingRoll extends RollDialogSpec {
  /** Damage to roll automatically once an attack lands, if this was an attack. */
  damage: { dice: { count: number; die: number }; proficiency: number; modifier: number } | null;
}

let entryCounter = 0;
const nextEntryId = () => {
  entryCounter += 1;
  return `roll-${Date.now().toString(36)}-${entryCounter.toString(36)}`;
};

export function SheetRoute({
  sheet,
  update,
  rng,
  characterId,
  send,
  sharedLog,
}: SheetRouteProps) {
  const online = characterId !== undefined && send !== undefined;
  const view = useMemo(() => selectSheetView(sheet), [sheet]);
  const character = sheet.character;

  const [log, setLog] = useState<readonly RollEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRoll | null>(null);
  const [outcome, setOutcome] = useState<DualityRollOutcome | null>(null);
  const [showDamage, setShowDamage] = useState(false);
  const [showDeathMove, setShowDeathMove] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [duringRest, setDuringRest] = useState(false);

  /**
   * Applies a change. Offline this runs the pure reducer locally; in a campaign it
   * sends the equivalent intent and waits for the server's broadcast.
   */
  const run = (
    transition: (s: SheetState) => { sheet: SheetState; effect: SheetEffect },
    intent?: RoomEvent,
  ) => {
    if (online && intent !== undefined) {
      send(intent);
      return;
    }
    const effect = update(transition);
    if (effect === null) return;
    if (effect.message !== null) setToast(effect.message);
    if (effect.deathMoveRequired) setShowDeathMove(true);
  };

  /** Builds a character intent for the character this sheet is showing. */
  const forMe = <T extends Record<string, unknown>>(event: T) =>
    ({ ...event, characterId: characterId ?? '' }) as unknown as RoomEvent;

  // Whose name a roll is logged under. In a live room the server stamps this from
  // the session; offline it is simply this character.
  const rollerName = character.name ?? 'Tú';

  const experiences = useMemo(
    () => Object.entries(character.experiences).map(([name, modifier]) => ({ name, modifier })),
    [character.experiences],
  );

  const roll = (request: Parameters<typeof makeDualityRoll>[1]) => {
    if (pending === null) return;

    // In a campaign the server rolls: dice are seeded there so the whole table sees
    // the same result and it can be audited afterwards.
    if (online) {
      send(forMe({ type: 'rollDuality', request }));
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
      closeRoll();
      return;
    }

    const transition = makeDualityRoll(sheet, request, rng);
    if (transition.outcome === null) {
      if (transition.effect.message !== null) setToast(transition.effect.message);
      return;
    }

    const result = transition.outcome;
    setOutcome(result);
    update(() => ({ sheet: transition.sheet, effect: transition.effect }));

    setLog((current) =>
      appendRoll(current, {
        kind: 'duality',
        id: nextEntryId(),
        at: Date.now(),
        by: rollerName,
        label: pending.title,
        roll: result.roll,
        difficulty: request.difficulty,
        outcome: result.result.outcome,
        experiences: request.experiences.map((e) => e.name),
      }),
    );

    // An attack that lands rolls its damage straight away, critical included.
    if (pending.damage !== null && result.result.success) {
      const damage = makeDamageRoll(
        { ...pending.damage, critical: result.result.criticalDamage },
        rng,
      );
      setLog((current) =>
        appendRoll(current, {
          kind: 'damage',
          id: nextEntryId(),
          at: Date.now(),
          by: rollerName,
          label: `${pending.title} — daño`,
          roll: damage,
          critical: result.result.criticalDamage,
        }),
      );
    }
  };

  const closeRoll = () => {
    setPending(null);
    setOutcome(null);
  };

  const openTraitRoll = (traitLabel: string, modifier: number) => {
    setOutcome(null);
    setPending({ title: `Tirada de ${traitLabel}`, modifiers: modifier, modifierLabel: traitLabel, damage: null });
  };

  const openAttackRoll = (weaponName: string, trait: string, modifier: number, damage: PendingRoll['damage']) => {
    setOutcome(null);
    setPending({
      title: `Ataque — ${weaponName}`,
      modifiers: modifier,
      modifierLabel: `Ataque de ${prettify(trait)}`,
      damage,
    });
  };

  const rollLooseDamage = (weaponName: string, damage: NonNullable<PendingRoll['damage']>) => {
    if (online) {
      send(
        forMe({
          type: 'rollDamage',
          label: `${weaponName} — daño`,
          dice: damage.dice,
          proficiency: damage.proficiency,
          modifier: damage.modifier,
          critical: false,
        }),
      );
      return;
    }

    const result = makeDamageRoll({ ...damage, critical: false }, rng);
    setLog((current) =>
      appendRoll(current, {
        kind: 'damage',
        id: nextEntryId(),
        at: Date.now(),
        by: rollerName,
        label: `${weaponName} — daño`,
        roll: result,
        critical: false,
      }),
    );
    setToast(`${weaponName}: ${result.total} de daño.`);
  };

  const applyDamageEntry = (options: TakeDamageOptions) => {
    run((s) => takeDamage(s, options), forMe({ type: 'takeDamage', ...options, armorSlotsToMark: options.armorSlotsToMark }));
    setShowDamage(false);
  };

  const vulnerable = isVulnerable(sheet);

  return (
    <section className="sheet-backdrop">
      <div className="card-head">
        <div>
          <h1>{character.name ?? 'Personaje sin nombre'}</h1>
          <p className="muted">
            Nivel {character.level} {view.className} · {view.subclassName} ·{' '}
            {view.heritageLabel} · {view.communityName}
            {vulnerable ? <span className="badge warn"> Vulnerable</span> : null}
          </p>
        </div>
        <div className="row">
          <button type="button" onClick={() => setShowDamage(true)}>
            Recibir daño
          </button>
          <button type="button" onClick={() => setShowLevelUp(true)}>
            Subir de nivel
          </button>
          <button type="button" onClick={() => setShowPrint(true)}>
            Exportar PDF
          </button>
          <Link to="/">
            <button type="button">Personajes</button>
          </Link>
        </div>
      </div>

      <div className="sheet-layout">
        <div>
          <div className="panel">
            <SectionHead>Rasgos</SectionHead>
            <p className="muted">Haz clic en un rasgo para hacer una tirada de acción con él.</p>
            <div className="stat-grid">
              {view.traits.map((trait) => (
                <button
                  key={trait.trait}
                  type="button"
                  className="stat trait-button"
                  onClick={() => openTraitRoll(trait.label, trait.modifier)}
                >
                  <span className="trait-mod">
                    {trait.modifier >= 0 ? `+${trait.modifier}` : `−${Math.abs(trait.modifier)}`}
                  </span>
                  <span className="stat-label">{trait.label}</span>
                </button>
              ))}
            </div>

            {view.spellcastTrait !== null ? (
              <div className="row mt-4">
                <button
                  type="button"
                  onClick={() => {
                    const trait = view.spellcastTrait;
                    if (trait === null) return;
                    openTraitRoll(`Conjuro (${prettify(trait)})`, character.traits[trait]);
                  }}
                >
                  Tirada de Conjuro
                </button>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <SectionHead>Defensas</SectionHead>
            <div className="stat-grid">
              <div className="stat">
                <span className="stat-value">{character.evasion}</span>
                <span className="stat-label">Evasión</span>
              </div>
              <div className="stat">
                <span className="stat-value">{character.armorScore}</span>
                <span className="stat-label">Puntuación de Armadura</span>
              </div>
              <div className="stat">
                <span className="stat-value">{character.major}</span>
                <span className="stat-label">Daño Mayor</span>
              </div>
              <div className="stat">
                <span className="stat-value">{character.severe}</span>
                <span className="stat-label">Daño Grave</span>
              </div>
              <div className="stat">
                <span className="stat-value">{character.proficiency}</span>
                <span className="stat-label">Competencia</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <Tracker
              label="Puntos de Vida"
              marked={sheet.hpMarked}
              total={character.hpSlots}
              fillLabel="marcados"
              onMark={() => run((s) => markSheetHP(s), forMe({ type: 'markHP', amount: 1 }))}
              onClear={() => run((s) => clearSheetHP(s), forMe({ type: 'clearHP', amount: 1 }))}
            />
            <Tracker
              label="Estrés"
              marked={sheet.stressMarked}
              total={character.stressSlots}
              tone="stress"
              fillLabel="marcados"
              note={vulnerable ? 'Vulnerable' : undefined}
              onMark={() => run((s) => markSheetStress(s), forMe({ type: 'markStress', amount: 1 }))}
              onClear={() => run((s) => clearSheetStress(s), forMe({ type: 'clearStress', amount: 1 }))}
            />
            <Tracker
              label="Esperanza"
              marked={sheet.hope}
              total={MAX_HOPE}
              tone="hope"
              fillLabel="en reserva"
              onMark={() => run((s) => gainSheetHope(s), forMe({ type: 'gainHope', amount: 1 }))}
              onClear={() => run((s) => spendSheetHope(s), forMe({ type: 'spendHope', amount: 1 }))}
            />
            <Tracker
              label="Ranuras de Armadura"
              marked={sheet.armorSlotsMarked}
              total={character.armorScore}
              tone="armor"
              fillLabel="marcadas"
              onMark={() => run((s) => markSheetArmorSlot(s), forMe({ type: 'markArmorSlot', amount: 1 }))}
              onClear={() => run((s) => clearSheetArmorSlot(s), forMe({ type: 'clearArmorSlot', amount: 1 }))}
            />

            <div className="tracker">
              <div className="tracker-head">
                <h3>Oro</h3>
                <span className="muted">
                  {sheet.gold.chests} cofres · {sheet.gold.bags} bolsas · {sheet.gold.handfuls}{' '}
                  puñados
                </span>
              </div>
              <div className="row">
                {(['handfuls', 'bags', 'chests'] as const).map((unit) => (
                  <span key={unit} className="row">
                    <button type="button" onClick={() => run((s) => spendSheetGold(s, 1, unit), forMe({ type: 'spendGold', amount: 1, unit }))}>
                      − {unit === 'handfuls' ? 'puñado' : unit === 'bags' ? 'bolsa' : 'cofre'}
                    </button>
                    <button type="button" onClick={() => run((s) => gainSheetGold(s, 1, unit), forMe({ type: 'gainGold', amount: 1, unit }))}>
                      + {unit === 'handfuls' ? 'puñado' : unit === 'bags' ? 'bolsa' : 'cofre'}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="panel">
            <SectionHead>Armas y armadura activas</SectionHead>
            {[view.primaryWeapon, view.secondaryWeapon].map((weapon, index) =>
              weapon === null ? null : (
                <div className="card" key={weapon.id}>
                  <div className="card-head">
                    <strong>
                      {weapon.name}{' '}
                      <span className="muted">{index === 0 ? '(primaria)' : '(secundaria)'}</span>
                    </strong>
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
                        onClick={() => rollLooseDamage(weapon.name, weaponDamage(weapon, character))}
                      >
                        Daño
                      </button>
                    </div>
                  </div>
                  <span className="option-meta">
                    {prettify(weapon.trait)} · {prettify(weapon.range)} ·{' '}
                    {describeWeaponDamage(weapon, character)} {prettify(weapon.damageType)} ·{' '}
                    {prettify(weapon.burden)}
                  </span>
                  {weapon.feature ? (
                    <p className="card-text">
                      <strong>{weapon.feature.name}:</strong> {weapon.feature.text}
                    </p>
                  ) : null}
                </div>
              ),
            )}

            {view.armor === null ? null : (
              <div className="card">
                <strong>{view.armor.name}</strong>
                <span className="option-meta">
                  {' '}
                  Umbrales base {view.armor.baseThresholds.major}/
                  {view.armor.baseThresholds.severe} · Puntuación base {view.armor.baseScore}
                </span>
                {view.armor.feature ? (
                  <p className="card-text">
                    <strong>{view.armor.feature.name}:</strong> {view.armor.feature.text}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="panel">
            <SectionHead>Experiencias</SectionHead>
            <div className="row">
              {experiences.map((experience) => (
                <span key={experience.name} className="badge">
                  {experience.name} {experience.modifier >= 0 ? '+' : ''}
                  {experience.modifier}
                </span>
              ))}
            </div>
          </div>

          <div className="panel">
            <SectionHead>Rasgos de clase</SectionHead>
            {[
              { heading: `${view.className} — Rasgo de Esperanza`, features: [view.hopeFeature] },
              { heading: `${view.className}`, features: view.classFeatures },
              { heading: view.subclassName, features: view.subclassFeatures },
              { heading: view.heritageLabel, features: view.ancestryFeatures },
              { heading: view.communityName, features: [view.communityFeature] },
            ].map((group) => (
              <div key={group.heading}>
                <h3>{group.heading}</h3>
                {group.features
                  .filter((feature) => feature.name !== '')
                  .map((feature) => (
                    <div className="card" key={feature.name}>
                      <strong>{feature.name}</strong>
                      <p className="card-text">{feature.text}</p>
                    </div>
                  ))}
              </div>
            ))}
          </div>

          <div className="panel">
            <SectionHead>Inventario</SectionHead>
            <ul>
              {character.inventory.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <aside>
          <LoadoutPanel
            loadout={view.loadout}
            vault={view.vault}
            duringRest={duringRest}
            onToggleRest={() => setDuringRest((current) => !current)}
            onRecall={(cardId, vaulting) =>
              run(
                (s) => recallFromVault(s, cardId, recallCostOf(cardId), { duringRest, vaulting }),
                forMe({
                  type: 'recallCard',
                  cardId,
                  recallCost: recallCostOf(cardId),
                  duringRest,
                  ...(vaulting === undefined ? {} : { vaulting }),
                }),
              )
            }
            onVault={(cardId) => run((s) => sendToVault(s, cardId), forMe({ type: 'vaultCard', cardId }))}
          />
          <RollLogPanel entries={sharedLog ?? log} />
        </aside>
      </div>

      {pending !== null ? (
        <RollDialog
          spec={pending}
          experiences={experiences}
          hope={sheet.hope}
          outcome={outcome}
          onRoll={(request) => roll({ ...request, label: pending.title })}
          onClose={closeRoll}
        />
      ) : null}

      {showDamage ? (
        <DamageDialog
          armorSlotsAvailable={character.armorScore - sheet.armorSlotsMarked}
          thresholds={character.thresholds}
          onApply={applyDamageEntry}
          onClose={() => setShowDamage(false)}
        />
      ) : null}

      {showDeathMove ? <DeathMoveDialog onClose={() => setShowDeathMove(false)} /> : null}

      {showLevelUp ? (
        <LevelUpDialog
          level={character.level}
          experienceNames={experiences.map((e) => e.name)}
          traitNames={view.traits.map((t) => t.trait)}
          onApply={(choices) => {
            const levelUpChoices = {
              advancements: choices.advancements as Advancement[],
              traitsToIncrease: choices.traitsToIncrease,
              experiencesToIncrease: choices.experiencesToIncrease,
              ...(choices.newExperienceName === ''
                ? {}
                : { newExperienceName: choices.newExperienceName }),
            };
            run(
              (s) => applyLevelUp(s, levelUpChoices),
              forMe({ type: 'levelUp', choices: levelUpChoices }),
            );
            setShowLevelUp(false);
          }}
          onClose={() => setShowLevelUp(false)}
        />
      ) : null}

      {showPrint ? <PrintableSheet sheet={sheet} onClose={() => setShowPrint(false)} /> : null}

      {toast !== null ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </section>
  );
}
