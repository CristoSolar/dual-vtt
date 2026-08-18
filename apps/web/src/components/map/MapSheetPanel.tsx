import { MAX_HOPE } from '@daggerheart/rules';
import type { RoomEvent } from '@daggerheart/protocol';
import { useMemo, useState } from 'react';

import { RollDialog, type RollDialogSpec } from '../sheet/RollDialog.js';
import { Tracker } from '../Tracker.js';
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

/**
 * A trimmed character sheet for the map's floating panel: traits, weapons, and
 * trackers only — enough to roll without leaving the map. Always online (the map
 * only exists inside a joined campaign), so unlike `SheetRoute` this never runs the
 * offline reducer: every action is an intent, and the result arrives through the
 * shared room state and roll log the caller already has.
 */
export function MapSheetPanel({ sheet, characterId, send, sharedLog }: MapSheetPanelProps) {
  const view = useMemo(() => selectSheetView(sheet), [sheet]);
  const character = sheet.character;
  const [pending, setPending] = useState<PendingRoll | null>(null);

  const forMe = <T extends Record<string, unknown>>(event: T) =>
    ({ ...event, characterId }) as unknown as RoomEvent;

  const experiences = useMemo(
    () => Object.entries(character.experiences).map(([name, modifier]) => ({ name, modifier })),
    [character.experiences],
  );

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
    <div className="map-sheet-panel">
      <h3>{character.name ?? 'Personaje sin nombre'}</h3>

      <Tracker
        label="Puntos de Vida"
        marked={sheet.hpMarked}
        total={character.hpSlots}
        fillLabel="marcados"
        onMark={() => send(forMe({ type: 'markHP', amount: 1 }))}
        onClear={() => send(forMe({ type: 'clearHP', amount: 1 }))}
      />
      <Tracker
        label="Estrés"
        marked={sheet.stressMarked}
        total={character.stressSlots}
        fillLabel="marcados"
        onMark={() => send(forMe({ type: 'markStress', amount: 1 }))}
        onClear={() => send(forMe({ type: 'clearStress', amount: 1 }))}
      />
      <Tracker
        label="Esperanza"
        marked={sheet.hope}
        total={MAX_HOPE}
        tone="hope"
        fillLabel="en reserva"
        onMark={() => send(forMe({ type: 'gainHope', amount: 1 }))}
        onClear={() => send(forMe({ type: 'spendHope', amount: 1 }))}
      />

      <h3 className="mt-4">Rasgos</h3>
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

      {[view.primaryWeapon, view.secondaryWeapon].map((weapon, index) =>
        weapon === null ? null : (
          <div className="card mt-3" key={weapon.id}>
            <div className="card-head">
              <strong>
                {weapon.name} <span className="muted">{index === 0 ? '(primaria)' : '(secundaria)'}</span>
              </strong>
            </div>
            <span className="option-meta">
              {prettify(weapon.trait)} · {describeWeaponDamage(weapon, character)} {prettify(weapon.damageType)}
            </span>
            <div className="row mt-2">
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
              <button type="button" onClick={() => rollLooseDamage(weapon.name, weaponDamage(weapon, character))}>
                Daño
              </button>
            </div>
          </div>
        ),
      )}

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

      {sharedLog !== undefined && sharedLog.length > 0 ? (
        <p className="muted mt-3">Última tirada: {sharedLog[sharedLog.length - 1]?.label}</p>
      ) : null}
    </div>
  );
}
