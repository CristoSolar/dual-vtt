import {
  ADVANCEMENT_SLOT_COST,
  SLOTS_PER_LEVEL,
  STARTING_EXPERIENCE_MODIFIER,
  TIER_ACHIEVEMENT_LEVELS,
  type Advancement,
} from '@daggerheart/rules';
import { useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
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

const ADVANCEMENT_LABEL_KEYS: Record<Advancement, MessageKey> = {
  traits: 'sheet.levelUp.advancement.traits',
  hitPoint: 'sheet.levelUp.advancement.hitPoint',
  stress: 'sheet.levelUp.advancement.stress',
  experience: 'sheet.levelUp.advancement.experience',
  domainCard: 'sheet.levelUp.advancement.domainCard',
  evasion: 'sheet.levelUp.advancement.evasion',
  subclass: 'sheet.levelUp.advancement.subclass',
  proficiency: 'sheet.levelUp.advancement.proficiency',
  multiclass: 'sheet.levelUp.advancement.multiclass',
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
  const offered = (Object.keys(ADVANCEMENT_LABEL_KEYS) as Advancement[]).filter(
    (a) => a !== 'multiclass',
  );

  return (
    <Dialog title={t('sheet.levelUp.title', { level: level + 1 })} onClose={onClose}>
      <p className="muted">
        {t('sheet.levelUp.spendHint', { slots: SLOTS_PER_LEVEL, spent })}
      </p>

      <fieldset>
        <legend>{t('sheet.levelUp.advancementsLegend')}</legend>
        <div className="grid cols-2">
          {offered.map((advancement) => (
            <button
              key={advancement}
              type="button"
              className="option"
              aria-pressed={advancements.includes(advancement)}
              onClick={() => toggle(advancement)}
            >
              <span className="option-name">{t(ADVANCEMENT_LABEL_KEYS[advancement])}</span>
              <span className="option-meta">
                {t('sheet.levelUp.slotCost', { count: ADVANCEMENT_SLOT_COST[advancement] })}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {advancements.includes('traits') ? (
        <fieldset>
          <legend>{t('sheet.levelUp.traitsLegend')}</legend>
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
          <legend>{t('sheet.levelUp.experiencesLegend')}</legend>
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
          {t('sheet.levelUp.newExperienceLabel', {
            levels: TIER_ACHIEVEMENT_LEVELS.join(', '),
            modifier: STARTING_EXPERIENCE_MODIFIER,
          })}
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
        {t('sheet.levelUp.confirm')}
      </button>
    </Dialog>
  );
}
