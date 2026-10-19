import type { JournalEntry } from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import { newlyShared } from '../src/state/journal.js';

const entry = (id: string, shared: JournalEntry['shared']): JournalEntry => ({
  id,
  title: id,
  body: '',
  image: null,
  shared,
});

describe('newlyShared', () => {
  it('returns shared entries this client has not seen', () => {
    const journal = [entry('a', 'all'), entry('b', 'all'), entry('c', 'gm')];
    expect(newlyShared(journal, new Set(['a'])).map((e) => e.id)).toEqual(['b']);
  });

  it('returns nothing once every shared entry has been seen', () => {
    expect(newlyShared([entry('a', 'all')], new Set(['a']))).toEqual([]);
  });
});
