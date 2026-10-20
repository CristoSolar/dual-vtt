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
