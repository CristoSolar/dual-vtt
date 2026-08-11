import {
  ADVANCEMENT_SLOT_COST,
  SLOTS_PER_LEVEL,
  STARTING_EXPERIENCE_MODIFIER,
  TIER_ACHIEVEMENT_LEVELS,
  type Advancement,
} from '@daggerheart/rules';
import { useState } from 'react';

import { Dialog } from '../Dialog.js';

interface LevelUpDialogProps {
  level: number;
  experienceNames: readonly string[];
  traitNames: readonly string[];
  onApply: (choices: {
    advancements: Advancement[];
    traitsToIncrease: string[];
    experiencesToIncrease: string[];
    newExperienceName: string;
  }) => void;
  onClose: () => void;
}

const ADVANCEMENT_LABELS: Record<Advancement, string> = {
  traits: 'Aumenta dos Rasgos',
  hitPoint: 'Añade una ranura de Punto de Vida',
  stress: 'Añade una ranura de Estrés',
  experience: 'Aumenta dos Experiencias',
  domainCard: 'Toma una carta de Dominio extra',
  evasion: 'Aumenta Evasión',
  subclass: 'Mejora la Subclase',
  proficiency: 'Aumenta Competencia',
  multiclass: 'Multiclase',
};

/** Collects the two advancement slots and passes them to the rules engine. */
export function LevelUpDialog({
  level,
  experienceNames,
  traitNames,
  onApply,
  onClose,
}: LevelUpDialogProps) {
  const [advancements, setAdvancements] = useState<Advancement[]>([]);
  const [traits, setTraits] = useState<string[]>([]);
  const [experiences, setExperiences] = useState<string[]>([]);
  const [newExperience, setNewExperience] = useState('');

  const spent = advancements.reduce((sum, a) => sum + ADVANCEMENT_SLOT_COST[a], 0);

  const toggle = (advancement: Advancement) => {
    setAdvancements((current) =>
      current.includes(advancement)
        ? current.filter((a) => a !== advancement)
        : [...current, advancement],
    );
  };

  const toggleIn = (list: string[], value: string, limit: number): string[] =>
    list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value].slice(-limit);

  // Multiclassing isn't representable by the character model yet, so it isn't offered.
  const offered = (Object.keys(ADVANCEMENT_LABELS) as Advancement[]).filter(
    (a) => a !== 'multiclass',
  );

  return (
    <Dialog title={`Subir al nivel ${level + 1}`} onClose={onClose}>
      <p className="muted">
        Gasta exactamente {SLOTS_PER_LEVEL} ranuras de mejora — llevas {spent} elegidas.
      </p>

      <fieldset>
        <legend>Mejoras</legend>
        <div className="grid cols-2">
          {offered.map((advancement) => (
            <button
              key={advancement}
              type="button"
              className="option"
              aria-pressed={advancements.includes(advancement)}
              onClick={() => toggle(advancement)}
            >
              <span className="option-name">{ADVANCEMENT_LABELS[advancement]}</span>
              <span className="option-meta">
                {ADVANCEMENT_SLOT_COST[advancement]} ranura
                {ADVANCEMENT_SLOT_COST[advancement] > 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {advancements.includes('traits') ? (
        <fieldset>
          <legend>Rasgos a aumentar (elige dos)</legend>
          <div className="row">
            {traitNames.map((trait) => (
              <button
                key={trait}
                type="button"
                className="option w-auto"
                aria-pressed={traits.includes(trait)}
                onClick={() => setTraits((current) => toggleIn(current, trait, 2))}
              >
                {trait}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {advancements.includes('experience') ? (
        <fieldset>
          <legend>Experiencias a aumentar (elige dos)</legend>
          <div className="row">
            {experienceNames.map((name) => (
              <button
                key={name}
                type="button"
                className="option w-auto"
                aria-pressed={experiences.includes(name)}
                onClick={() => setExperiences((current) => toggleIn(current, name, 2))}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="mb-4">
        <label htmlFor="new-experience">
          Nueva Experiencia (los niveles {TIER_ACHIEVEMENT_LEVELS.join(', ')} otorgan una a +
          {STARTING_EXPERIENCE_MODIFIER})
        </label>
        <input
          id="new-experience"
          type="text"
          value={newExperience}
          onChange={(event) => setNewExperience(event.target.value)}
        />
      </div>

      <button
        type="button"
        disabled={spent !== SLOTS_PER_LEVEL}
        onClick={() =>
          onApply({
            advancements,
            traitsToIncrease: traits,
            experiencesToIncrease: experiences,
            newExperienceName: newExperience.trim(),
          })
        }
      >
        Confirmar subida de nivel
      </button>
    </Dialog>
  );
}
