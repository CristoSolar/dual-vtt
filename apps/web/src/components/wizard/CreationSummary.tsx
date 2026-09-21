import type { CreationState } from '@daggerheart/character';
import { srd } from '@daggerheart/srd-data';

import { t } from '../../i18n/index.js';
import { label as prettify } from '../../state/selectors.js';
import { SectionHead } from '../SectionHead.js';

/** One line of the summary: a label and whatever was chosen, or a dash. */
function Line({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="row spread">
      <span className="muted">{label}</span>
      <span>{value ?? '—'}</span>
    </div>
  );
}

/**
 * What the character will be, read back before it is created.
 *
 * Creation is nine steps deep and the last one asks about connections, so by the
 * time somebody presses finish they made the class choice a long time ago. This
 * says it back to them in one place.
 */
export function CreationSummary({ state }: { state: CreationState }) {
  const nameOf = <T extends { id: string; name: string }>(
    all: readonly T[],
    id: string | null,
  ): string | null => (id === null ? null : (all.find((entry) => entry.id === id)?.name ?? id));

  const heritage =
    state.heritage === null
      ? null
      : state.heritage.kind === 'single'
        ? nameOf(srd().ancestries, state.heritage.ancestryId)
        : t('wizard.summary.mixed', {
            first: nameOf(srd().ancestries, state.heritage.first.ancestryId) ?? '',
            second: nameOf(srd().ancestries, state.heritage.second.ancestryId) ?? '',
          });

  const traits =
    state.traits === null
      ? null
      : Object.entries(state.traits)
          .map(([trait, value]) => `${prettify(trait)} ${value >= 0 ? '+' : ''}${value}`)
          .join(' · ');

  const cards = state.domainCardIds
    .map((id) => nameOf(srd().domainCards, id))
    .filter((name): name is string => name !== null)
    .join(', ');

  return (
    <div className="panel">
      <SectionHead>{t('wizard.summary.title')}</SectionHead>
      <Line label={t('wizard.summary.name')} value={state.name} />
      <Line label={t('wizard.summary.class')} value={nameOf(srd().classes, state.classId)} />
      <Line
        label={t('wizard.summary.subclass')}
        value={nameOf(srd().subclasses, state.subclassId)}
      />
      <Line label={t('wizard.summary.heritage')} value={heritage} />
      <Line
        label={t('wizard.summary.community')}
        value={nameOf(srd().communities, state.communityId)}
      />
      <Line label={t('wizard.summary.traits')} value={traits} />
      <Line
        label={t('wizard.summary.experiences')}
        value={
          state.experiences.length === 0
            ? null
            : state.experiences.map((experience) => experience.name).join(', ')
        }
      />
      <Line label={t('wizard.summary.cards')} value={cards === '' ? null : cards} />
    </div>
  );
}
