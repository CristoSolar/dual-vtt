import {
  availableOptions,
  type CreationAction,
  type CreationState,
  type Equipment,
  type Trait,
  type ValidationError,
} from '@daggerheart/character';
import { srd } from '@daggerheart/srd-data';
import { useState } from 'react';

import { fieldErrors } from '../../state/useCreation.js';
import { formatSigned, label as prettify } from '../../state/selectors.js';
import { OptionList } from '../OptionList.js';
import { FieldErrors, TextField } from './StepFields.js';

export interface StepProps {
  state: CreationState;
  dispatch: (action: CreationAction) => void;
  errors: readonly ValidationError[];
}

/** Step 1 — class and subclass. */
export function StepClass({ state, dispatch, errors }: StepProps) {
  const options = availableOptions(state, 1);
  return (
    <>
      <OptionList
        legend="Clase"
        options={options.classes.map((c) => ({
          id: c.id,
          name: c.name,
          meta: `Evasión ${c.startingEvasion} · PV ${c.startingHP} · ${c.domains.join(' y ')}`,
          image: `/images/classes/${c.id}.png`,
        }))}
        selectedId={state.classId}
        onSelect={(classId) => dispatch({ type: 'chooseClass', classId })}
      />
      <FieldErrors errors={fieldErrors(errors, 'classId')} />

      <OptionList
        legend="Subclase"
        options={options.subclasses.map((s) => ({
          id: s.id,
          name: s.name,
          meta:
            s.spellcastTrait === null
              ? 'Sin Rasgo de Conjuro'
              : `Conjuro: ${prettify(s.spellcastTrait)}`,
        }))}
        selectedId={state.subclassId}
        onSelect={(subclassId) => dispatch({ type: 'chooseSubclass', subclassId })}
        emptyMessage="Elige primero una clase."
      />
      <FieldErrors errors={fieldErrors(errors, 'subclassId')} />
    </>
  );
}

/** Step 2 — ancestry (single or mixed) and community. */
export function StepHeritage({ state, dispatch, errors }: StepProps) {
  const options = availableOptions(state, 2);
  const heritage = state.heritage;
  const [mixed, setMixed] = useState(heritage?.kind === 'mixed');

  const firstId = heritage?.kind === 'mixed' ? heritage.first.ancestryId : null;
  const secondId = heritage?.kind === 'mixed' ? heritage.second.ancestryId : null;

  // Both halves are picked before a mixed heritage is committed, so the reducer
  // never sees a half-built one. It always pairs a first-listed feature with a
  // second-listed one; the reducer validates the rest.
  const [pendingFirst, setPendingFirst] = useState<string | null>(firstId);
  const [pendingSecond, setPendingSecond] = useState<string | null>(secondId);

  const selectMixed = (which: 'first' | 'second', ancestryId: string) => {
    const nextFirst = which === 'first' ? ancestryId : pendingFirst;
    const nextSecond = which === 'second' ? ancestryId : pendingSecond;
    setPendingFirst(nextFirst);
    setPendingSecond(nextSecond);
    if (nextFirst !== null && nextSecond !== null) {
      dispatch({
        type: 'chooseMixedAncestry',
        first: { ancestryId: nextFirst, slot: 'first' },
        second: { ancestryId: nextSecond, slot: 'second' },
      });
    }
  };

  return (
    <>
      <div className="row mb-4">
        <button type="button" aria-pressed={!mixed} onClick={() => setMixed(false)}>
          Ascendencia única
        </button>
        <button type="button" aria-pressed={mixed} onClick={() => setMixed(true)}>
          Ascendencia mixta
        </button>
      </div>

      {mixed ? (
        <>
          <p className="muted">
            Una ascendencia mixta toma el primer rasgo listado de una ascendencia y el
            segundo rasgo listado de otra.
          </p>
          <OptionList
            legend="Primer rasgo listado de"
            options={options.mixedFirstSlot.map((a) => ({
              id: a.id,
              name: a.name,
              meta: a.features.find((f) => f.slot === 'first')?.name,
              image: `/images/ancestries/${a.id}.png`,
            }))}
            selectedId={pendingFirst}
            onSelect={(id) => selectMixed('first', id)}
          />
          <OptionList
            legend="Segundo rasgo listado de"
            options={options.mixedSecondSlot.map((a) => ({
              id: a.id,
              name: a.name,
              meta: a.features.find((f) => f.slot === 'second')?.name,
              image: `/images/ancestries/${a.id}.png`,
            }))}
            selectedId={pendingSecond}
            onSelect={(id) => selectMixed('second', id)}
          />
        </>
      ) : (
        <OptionList
          legend="Ascendencia"
          options={options.ancestries.map((a) => ({
            id: a.id,
            name: a.name,
            meta: a.features.map((f) => f.name).join(' · '),
            image: `/images/ancestries/${a.id}.png`,
          }))}
          selectedId={heritage?.kind === 'single' ? heritage.ancestryId : null}
          onSelect={(ancestryId) => dispatch({ type: 'chooseAncestry', ancestryId })}
        />
      )}
      <FieldErrors errors={fieldErrors(errors, 'heritage')} />

      <OptionList
        legend="Comunidad"
        options={options.communities.map((c) => ({
          id: c.id,
          name: c.name,
          meta: c.feature.name,
          image: `/images/communities/${c.id}.png`,
        }))}
        selectedId={state.communityId}
        onSelect={(communityId) => dispatch({ type: 'chooseCommunity', communityId })}
      />
      <FieldErrors errors={fieldErrors(errors, 'communityId')} />
    </>
  );
}

// Only Guardian and Warrior run both subclasses with no Spellcast trait — for
// those, Strength carries their weapons and armor, so it's the sane default.
// ponytail: a fixed fallback map, not a rules lookup — nothing in the SRD data
// names a "primary trait" for a class, so this is just a sensible starting point
// the player can override.
const NO_SPELLCAST_PRIMARY: Partial<Record<string, Trait>> = {
  guardian: 'strength',
  warrior: 'strength',
};

/** The trait a class leans on hardest, used only to pre-fill a suggestion. */
function primaryTraitFor(classId: string | null, subclassId: string | null): Trait | null {
  const subclass = srd().subclasses.find((s) => s.id === subclassId);
  if (subclass?.spellcastTrait != null) return subclass.spellcastTrait;
  if (classId !== null) return NO_SPELLCAST_PRIMARY[classId] ?? null;
  return null;
}

/**
 * Fills every trait from the modifier array, favouring the primary trait for
 * the biggest bonus and otherwise keeping a stable, predictable order — this
 * is a starting point to edit, not a build guide.
 */
function recommendedSpread(traits: readonly Trait[], modifiers: readonly number[], primary: Trait | null): Record<Trait, number> {
  const sorted = [...modifiers].sort((a, b) => b - a);
  const order =
    primary === null ? traits : [primary, ...traits.filter((t) => t !== primary)];
  const spread = {} as Record<Trait, number>;
  order.forEach((trait, index) => {
    spread[trait] = sorted[index] ?? 0;
  });
  return spread;
}

/** Step 3 — assign the trait array. */
export function StepTraits({ state, dispatch, errors }: StepProps) {
  const options = availableOptions(state, 3);
  const current: Record<Trait, number> =
    state.traits ??
    (Object.fromEntries(options.traits.map((t) => [t, 0])) as Record<Trait, number>);

  const setTrait = (trait: Trait, value: number) => {
    dispatch({ type: 'assignTraits', traits: { ...current, [trait]: value } });
  };

  // Show which modifiers are still unassigned, so the spread is easy to complete.
  const used = options.traits.map((t) => current[t]);
  const remaining = [...options.modifiers];
  for (const value of used) {
    const index = remaining.indexOf(value);
    if (index !== -1) remaining.splice(index, 1);
  }

  const primary = primaryTraitFor(state.classId, state.subclassId);
  const uniqueValues = [...new Set(options.modifiers)].sort((a, b) => b - a);

  return (
    <>
      <div className="row spread trait-points-bar">
        <p className="muted mb-0">
          Asigna {options.modifiers.map(formatSigned).join(', ')} entre los seis Rasgos.
        </p>
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: 'assignTraits',
              traits: recommendedSpread(options.traits, options.modifiers, primary),
            })
          }
        >
          Reparto recomendado
        </button>
      </div>
      <p className={remaining.length > 0 ? 'trait-points-remaining' : 'trait-points-remaining trait-points-done'}>
        {remaining.length > 0
          ? `Falta por colocar: ${remaining.map(formatSigned).join(', ')}`
          : 'Todos los modificadores están colocados.'}
      </p>
      <div className="grid cols-3">
        {options.traits.map((trait) => {
          // A value is unavailable for this trait once every copy of it lives on
          // another trait — except the one this select already holds, so picking
          // the same value back is always allowed.
          const othersUsed = options.traits.filter((t) => t !== trait).map((t) => current[t]);
          return (
            <div key={trait}>
              <label htmlFor={`trait-${trait}`}>
                {prettify(trait)}
                {trait === primary ? <span className="badge trait-primary-badge">Principal</span> : null}
              </label>
              <select
                id={`trait-${trait}`}
                value={String(current[trait])}
                onChange={(event) => setTrait(trait, Number(event.target.value))}
              >
                {uniqueValues.map((value) => {
                  const totalOfValue = options.modifiers.filter((m) => m === value).length;
                  const takenByOthers = othersUsed.filter((v) => v === value).length;
                  const left = totalOfValue - takenByOthers;
                  const disabled = left <= 0 && current[trait] !== value;
                  return (
                    <option key={value} value={value} disabled={disabled}>
                      {formatSigned(value)} (quedan {Math.max(left, 0)})
                    </option>
                  );
                })}
              </select>
            </div>
          );
        })}
      </div>
      <FieldErrors errors={fieldErrors(errors, 'traits')} />
    </>
  );
}

/** Step 4 — derived values, recorded rather than chosen. */
export function StepDerived({ state }: StepProps) {
  const { derived } = availableOptions(state, 4);
  if (derived === null) return <p className="muted">Elige primero una clase.</p>;

  const stats: [string, number][] = [
    ['Nivel', derived.level],
    ['Evasión', derived.evasion],
    ['Puntos de Vida', derived.hpSlots],
    ['Estrés', derived.stressSlots],
    ['Esperanza', derived.hope],
    ['Competencia', derived.proficiency],
  ];

  return (
    <>
      <p className="muted">
        Esto viene de tu clase. Los umbrales de daño se fijan al equipar armadura.
      </p>
      <div className="stat-grid">
        {stats.map(([name, value]) => (
          <div className="stat" key={name}>
            <span className="stat-value">{value}</span>
            <span className="stat-label">{name}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Step 5 — starting equipment. */
export function StepEquipment({ state, dispatch, errors }: StepProps) {
  const options = availableOptions(state, 5);
  const equipment = state.equipment;

  const update = (patch: Partial<Equipment>) => {
    const base: Equipment = equipment ?? {
      primaryWeaponId: '',
      secondaryWeaponId: null,
      armorId: '',
      potion: 'health',
      classItem: '',
      spellCarrier: null,
    };
    dispatch({ type: 'chooseEquipment', equipment: { ...base, ...patch } });
  };

  return (
    <>
      <OptionList
        legend="Arma principal"
        options={options.primaryWeapons.map((w) => ({
          id: w.id,
          name: w.name,
          meta: `${prettify(w.trait)} · ${prettify(w.range)} · ${prettify(w.burden)}${
            w.feature ? ` · ${w.feature.name}` : ''
          }`,
        }))}
        selectedId={equipment?.primaryWeaponId ?? null}
        onSelect={(primaryWeaponId) => update({ primaryWeaponId })}
      />
      <FieldErrors errors={fieldErrors(errors, 'equipment.primaryWeaponId')} />

      <OptionList
        legend="Arma secundaria (opcional)"
        options={options.secondaryWeapons.map((w) => ({
          id: w.id,
          name: w.name,
          meta: `${prettify(w.trait)} · ${prettify(w.range)}${w.feature ? ` · ${w.feature.name}` : ''}`,
        }))}
        selectedId={equipment?.secondaryWeaponId ?? null}
        onSelect={(id) =>
          update({ secondaryWeaponId: equipment?.secondaryWeaponId === id ? null : id })
        }
        emptyMessage="Un arma principal a dos manos no deja mano libre para una secundaria."
      />
      <FieldErrors errors={fieldErrors(errors, 'equipment.secondaryWeaponId')} />

      <OptionList
        legend="Armadura"
        options={options.armor.map((a) => ({
          id: a.id,
          name: a.name,
          meta: `Umbrales ${a.baseThresholds.major}/${a.baseThresholds.severe} · Puntuación ${a.baseScore}${
            a.feature ? ` · ${a.feature.name}` : ''
          }`,
        }))}
        selectedId={equipment?.armorId ?? null}
        onSelect={(armorId) => update({ armorId })}
      />
      <FieldErrors errors={fieldErrors(errors, 'equipment.armorId')} />

      <OptionList
        legend="Poción"
        options={options.potions.map((p) => ({
          id: p,
          name: p === 'health' ? 'Poción Menor de Vida' : 'Poción Menor de Vigor',
          meta: p === 'health' ? 'Cura 1d4 Puntos de Vida' : 'Libera 1d4 de Estrés',
        }))}
        selectedId={equipment?.potion ?? null}
        onSelect={(id) => update({ potion: id === 'stamina' ? 'stamina' : 'health' })}
      />

      <OptionList
        legend="Objeto de clase"
        options={options.classItems.map((item) => ({ id: item, name: item }))}
        selectedId={equipment?.classItem ?? null}
        onSelect={(classItem) => update({ classItem })}
      />
      <FieldErrors errors={fieldErrors(errors, 'equipment.classItem')} />

      {options.needsSpellCarrier ? (
        <TextField
          id="spell-carrier"
          label="Objeto en el que llevas tus conjuros"
          value={equipment?.spellCarrier ?? ''}
          placeholder="Un grimorio de cuero desgastado"
          onChange={(spellCarrier) => update({ spellCarrier: spellCarrier === '' ? null : spellCarrier })}
          errors={fieldErrors(errors, 'equipment.spellCarrier')}
        />
      ) : null}
    </>
  );
}

/** Step 6 — background. */
export function StepBackground({ state, dispatch, errors }: StepProps) {
  return (
    <TextField
      id="background"
      label="Trasfondo"
      multiline
      value={state.background ?? ''}
      placeholder="De dónde viene, qué dejó atrás, qué quiere."
      onChange={(background) => dispatch({ type: 'setBackground', background })}
      errors={fieldErrors(errors, 'background')}
    />
  );
}

/** Step 7 — two Experiences at +2. */
export function StepExperiences({ state, dispatch, errors }: StepProps) {
  const options = availableOptions(state, 7);
  const values = Array.from(
    { length: options.count },
    (_, i) => state.experiences[i]?.name ?? '',
  );

  const setAt = (index: number, name: string) => {
    const next = values.map((value, i) => ({
      name: i === index ? name : value,
      modifier: options.modifier,
    }));
    dispatch({ type: 'setExperiences', experiences: next.filter((e) => e.name !== '') });
  };

  return (
    <>
      <p className="muted">
        Dos Experiencias, cada una a {formatSigned(options.modifier)}. Una palabra o frase — no
        un conjuro ni una habilidad especial.
      </p>
      {values.map((value, index) => (
        <TextField
          key={index}
          id={`experience-${index}`}
          label={`Experiencia ${index + 1}`}
          value={value}
          placeholder={index === 0 ? 'Cazarrecompensas' : 'Lengua de Plata'}
          onChange={(name) => setAt(index, name)}
        />
      ))}
      <FieldErrors errors={fieldErrors(errors, 'experiences')} />
    </>
  );
}

/** Step 8 — two level-1 domain cards. */
export function StepDomainCards({ state, dispatch, errors }: StepProps) {
  const options = availableOptions(state, 8);
  const selected = state.domainCardIds;

  const toggle = (cardId: string) => {
    if (selected.includes(cardId)) {
      dispatch({ type: 'chooseDomainCards', cardIds: selected.filter((id) => id !== cardId) });
      return;
    }
    // Keep the newest two so a third pick replaces the oldest instead of erroring.
    const next = [...selected, cardId].slice(-options.count);
    dispatch({ type: 'chooseDomainCards', cardIds: next });
  };

  return (
    <>
      <p className="muted">
        Elige {options.count} — una de cada uno de tus Dominios, o ambas del mismo.
      </p>
      <ul className="options">
        {options.cards.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              className="option"
              aria-pressed={selected.includes(card.id)}
              onClick={() => toggle(card.id)}
            >
              <span className="option-name">{card.name}</span>
              <span className="option-meta">
                {prettify(card.domain)} · {prettify(card.type)} · Recuperación {card.recallCost}
              </span>
              <p className="card-text">{card.text}</p>
            </button>
          </li>
        ))}
      </ul>
      <FieldErrors errors={fieldErrors(errors, 'domainCardIds')} />
    </>
  );
}

/** Step 9 — connections to the other PCs. */
export function StepConnections({ state, dispatch, errors }: StepProps) {
  const connections = state.connections;
  const [who, setWho] = useState('');
  const [what, setWhat] = useState('');

  const add = () => {
    if (who.trim() === '' || what.trim() === '') return;
    dispatch({
      type: 'setConnections',
      connections: [...connections, { withCharacter: who.trim(), description: what.trim() }],
    });
    setWho('');
    setWhat('');
  };

  return (
    <>
      <p className="muted">
        Opcional — no pasa nada si no hay una conexión entre cada par de PJ.
      </p>
      <ul className="options cols-1">
        {connections.map((connection, index) => (
          <li key={`${connection.withCharacter}-${index}`} className="card">
            <div className="card-head">
              <strong>{connection.withCharacter}</strong>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: 'setConnections',
                    connections: connections.filter((_, i) => i !== index),
                  })
                }
              >
                Eliminar
              </button>
            </div>
            <p className="card-text">{connection.description}</p>
          </li>
        ))}
      </ul>

      <div className="grid cols-2">
        <TextField id="connection-who" label="Con" value={who} onChange={setWho} />
        <TextField id="connection-what" label="Conexión" value={what} onChange={setWhat} />
      </div>
      <button type="button" onClick={add}>
        Añadir conexión
      </button>
      <FieldErrors errors={fieldErrors(errors, 'connections')} />
    </>
  );
}
