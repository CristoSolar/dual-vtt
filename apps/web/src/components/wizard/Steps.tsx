import {
  availableOptions,
  type CreationAction,
  type CreationState,
  type Equipment,
  type Trait,
  type ValidationError,
} from '@daggerheart/character';
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
        legend="Class"
        options={options.classes.map((c) => ({
          id: c.id,
          name: c.name,
          meta: `Evasion ${c.startingEvasion} · HP ${c.startingHP} · ${c.domains.join(' & ')}`,
        }))}
        selectedId={state.classId}
        onSelect={(classId) => dispatch({ type: 'chooseClass', classId })}
      />
      <FieldErrors errors={fieldErrors(errors, 'classId')} />

      <OptionList
        legend="Subclass"
        options={options.subclasses.map((s) => ({
          id: s.id,
          name: s.name,
          meta:
            s.spellcastTrait === null
              ? 'No Spellcast trait'
              : `Spellcast: ${prettify(s.spellcastTrait)}`,
        }))}
        selectedId={state.subclassId}
        onSelect={(subclassId) => dispatch({ type: 'chooseSubclass', subclassId })}
        emptyMessage="Choose a class first."
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
          Single ancestry
        </button>
        <button type="button" aria-pressed={mixed} onClick={() => setMixed(true)}>
          Mixed ancestry
        </button>
      </div>

      {mixed ? (
        <>
          <p className="muted">
            A mixed ancestry takes the first-listed feature from one ancestry and the
            second-listed feature from another.
          </p>
          <OptionList
            legend="First-listed feature from"
            options={options.mixedFirstSlot.map((a) => ({
              id: a.id,
              name: a.name,
              meta: a.features.find((f) => f.slot === 'first')?.name,
            }))}
            selectedId={pendingFirst}
            onSelect={(id) => selectMixed('first', id)}
          />
          <OptionList
            legend="Second-listed feature from"
            options={options.mixedSecondSlot.map((a) => ({
              id: a.id,
              name: a.name,
              meta: a.features.find((f) => f.slot === 'second')?.name,
            }))}
            selectedId={pendingSecond}
            onSelect={(id) => selectMixed('second', id)}
          />
        </>
      ) : (
        <OptionList
          legend="Ancestry"
          options={options.ancestries.map((a) => ({
            id: a.id,
            name: a.name,
            meta: a.features.map((f) => f.name).join(' · '),
          }))}
          selectedId={heritage?.kind === 'single' ? heritage.ancestryId : null}
          onSelect={(ancestryId) => dispatch({ type: 'chooseAncestry', ancestryId })}
        />
      )}
      <FieldErrors errors={fieldErrors(errors, 'heritage')} />

      <OptionList
        legend="Community"
        options={options.communities.map((c) => ({
          id: c.id,
          name: c.name,
          meta: c.feature.name,
        }))}
        selectedId={state.communityId}
        onSelect={(communityId) => dispatch({ type: 'chooseCommunity', communityId })}
      />
      <FieldErrors errors={fieldErrors(errors, 'communityId')} />
    </>
  );
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

  return (
    <>
      <p className="muted">
        Assign {options.modifiers.map(formatSigned).join(', ')} across the six traits.
        {remaining.length > 0 ? ` Still to place: ${remaining.map(formatSigned).join(', ')}.` : ''}
      </p>
      <div className="grid cols-3">
        {options.traits.map((trait) => (
          <div key={trait}>
            <label htmlFor={`trait-${trait}`}>{prettify(trait)}</label>
            <select
              id={`trait-${trait}`}
              value={String(current[trait])}
              onChange={(event) => setTrait(trait, Number(event.target.value))}
            >
              {[...new Set(options.modifiers)]
                .sort((a, b) => b - a)
                .map((value) => (
                  <option key={value} value={value}>
                    {formatSigned(value)}
                  </option>
                ))}
            </select>
          </div>
        ))}
      </div>
      <FieldErrors errors={fieldErrors(errors, 'traits')} />
    </>
  );
}

/** Step 4 — derived values, recorded rather than chosen. */
export function StepDerived({ state }: StepProps) {
  const { derived } = availableOptions(state, 4);
  if (derived === null) return <p className="muted">Choose a class first.</p>;

  const stats: [string, number][] = [
    ['Level', derived.level],
    ['Evasion', derived.evasion],
    ['Hit Points', derived.hpSlots],
    ['Stress', derived.stressSlots],
    ['Hope', derived.hope],
    ['Proficiency', derived.proficiency],
  ];

  return (
    <>
      <p className="muted">
        These come from your class. Damage thresholds are set once you equip armor.
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
        legend="Primary weapon"
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
        legend="Secondary weapon (optional)"
        options={options.secondaryWeapons.map((w) => ({
          id: w.id,
          name: w.name,
          meta: `${prettify(w.trait)} · ${prettify(w.range)}${w.feature ? ` · ${w.feature.name}` : ''}`,
        }))}
        selectedId={equipment?.secondaryWeaponId ?? null}
        onSelect={(id) =>
          update({ secondaryWeaponId: equipment?.secondaryWeaponId === id ? null : id })
        }
        emptyMessage="A two-handed primary weapon leaves no hand for a secondary."
      />
      <FieldErrors errors={fieldErrors(errors, 'equipment.secondaryWeaponId')} />

      <OptionList
        legend="Armor"
        options={options.armor.map((a) => ({
          id: a.id,
          name: a.name,
          meta: `Thresholds ${a.baseThresholds.major}/${a.baseThresholds.severe} · Score ${a.baseScore}${
            a.feature ? ` · ${a.feature.name}` : ''
          }`,
        }))}
        selectedId={equipment?.armorId ?? null}
        onSelect={(armorId) => update({ armorId })}
      />
      <FieldErrors errors={fieldErrors(errors, 'equipment.armorId')} />

      <OptionList
        legend="Potion"
        options={options.potions.map((p) => ({
          id: p,
          name: p === 'health' ? 'Minor Health Potion' : 'Minor Stamina Potion',
          meta: p === 'health' ? 'Clear 1d4 Hit Points' : 'Clear 1d4 Stress',
        }))}
        selectedId={equipment?.potion ?? null}
        onSelect={(id) => update({ potion: id === 'stamina' ? 'stamina' : 'health' })}
      />

      <OptionList
        legend="Class item"
        options={options.classItems.map((item) => ({ id: item, name: item }))}
        selectedId={equipment?.classItem ?? null}
        onSelect={(classItem) => update({ classItem })}
      />
      <FieldErrors errors={fieldErrors(errors, 'equipment.classItem')} />

      {options.needsSpellCarrier ? (
        <TextField
          id="spell-carrier"
          label="Item you carry your spells in"
          value={equipment?.spellCarrier ?? ''}
          placeholder="A worn leather spellbook"
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
      label="Background"
      multiline
      value={state.background ?? ''}
      placeholder="Where they come from, what they left behind, what they want."
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
        Two Experiences, each at {formatSigned(options.modifier)}. A word or phrase — not
        a spell or a special ability.
      </p>
      {values.map((value, index) => (
        <TextField
          key={index}
          id={`experience-${index}`}
          label={`Experience ${index + 1}`}
          value={value}
          placeholder={index === 0 ? 'Bounty Hunter' : 'Silver Tongue'}
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
        Choose {options.count} — one from each of your domains, or both from one.
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
                {prettify(card.domain)} · {prettify(card.type)} · Recall {card.recallCost}
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
        Optional — it’s fine if there isn’t a connection between every pair of PCs.
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
                Remove
              </button>
            </div>
            <p className="card-text">{connection.description}</p>
          </li>
        ))}
      </ul>

      <div className="grid cols-2">
        <TextField id="connection-who" label="With" value={who} onChange={setWho} />
        <TextField id="connection-what" label="Connection" value={what} onChange={setWhat} />
      </div>
      <button type="button" onClick={add}>
        Add connection
      </button>
      <FieldErrors errors={fieldErrors(errors, 'connections')} />
    </>
  );
}
