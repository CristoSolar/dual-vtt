import { srd } from '@daggerheart/srd-data';

import { t } from '../i18n/index.js';

/**
 * A character's transformation as a small badge, for views of a character other
 * than its own sheet (the GM's party list, the campaign's members, the library).
 * Renders nothing when the character has none.
 */
export function TransformationBadge({ id }: { id: string | null }) {
  if (id === null) return null;
  const name = srd().transformations.find((tr) => tr.id === id)?.name ?? id;
  return (
    <span className="badge transformation" title={t('sheet.transformation.title')}>
      {name}
    </span>
  );
}
