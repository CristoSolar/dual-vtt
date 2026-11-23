import type { RollEntry } from '@daggerheart/protocol';
import { srd } from '@daggerheart/srd-data';

/**
 * What a logged feature or spell says, read from this client's SRD data so it
 * follows the reader's language. The name the server logged stands in when the
 * reference is not found; there is then no text to show.
 */
export function effectCopy(entry: Extract<RollEntry, { kind: 'effect' }>): {
  title: string;
  text: string | null;
} {
  const data = srd();
  // A grimoire's spell is logged by its place on the card; its name is read here,
  // in the reader's language, and the card's text still goes with it.
  if (entry.source === 'domainCard' && entry.feature !== null) {
    const card = data.domainCards.find((c) => c.id === entry.ref);
    const spell = data.cardMechanics.find((m) => m.id === entry.ref)?.abilities[entry.feature]?.name;
    if (card !== undefined) {
      return { title: spell == null ? card.name : `${card.name} — ${spell}`, text: card.text };
    }
  }
  const feature =
    entry.source === 'domainCard'
      ? data.domainCards.find((card) => card.id === entry.ref)
      : entry.source === 'hopeFeature'
        ? data.classes.find((c) => c.id === entry.ref)?.hopeFeature
        : entry.feature === null
          ? undefined
          : (entry.source === 'adversaryFeature'
              ? data.adversaries.find((a) => a.id === entry.ref)
              : data.environments.find((e) => e.id === entry.ref)
            )?.features[entry.feature];
  return feature === undefined
    ? { title: entry.title, text: null }
    : { title: feature.name, text: feature.text };
}
