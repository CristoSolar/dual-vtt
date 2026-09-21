# SRD extraction

Scripts that generate `../data/en/*.json` from the SRD PDF, currently
`DH_SRD_2_2026_08_25.pdf` (SRD 2.0). The JSON is committed, so you only need these
to re-derive the data against a newer SRD release.

## Regenerating

The scripts read `srd-bbox.xml`, which is produced by poppler's `pdftotext`. It is
not committed. Generate it from the repo root:

```sh
pdftotext -bbox-layout DH_SRD_2_2026_08_25.pdf packages/srd-data/extract/srd-bbox.xml
```

No poppler installed? Run it in a container instead:

```sh
docker run --rm -v "$PWD:/w" -w /w minidocks/poppler:latest \
  pdftotext -bbox-layout DH_SRD_2_2026_08_25.pdf packages/srd-data/extract/srd-bbox.xml
```

Then, from this directory:

```sh
for g in gen-equipment gen-classes gen-heritage gen-cards gen-adversaries \
         gen-environments gen-loot gen-beastforms; do node "$g.mjs"; done
```

Each script prints its entry counts and a `problems:` line. **`problems: 0` is the
contract** — any parse anomaly is reported rather than silently dropped or guessed.

`gen-equipment.mjs` writes `weapons.json` and `armor.json`. SRD 1.0's equipment
tables were transcribed inline because they were short; 2.0's are not, at 315 weapons
and 69 armors, so they are read off the page like everything else. Their cells are
positioned blocks under a header row, so a row is rebuilt by matching cells to the
column above them and to each other by height.

`gen-heritage.mjs` writes `ancestries.json` and `communities.json`, which share a
layout and a chapter boundary (both chapters print on page 38).

`gen-classes.mjs` writes two files, `classes.json` and `subclasses.json`, because one
pass over the Classes chapter produces both and they have to agree on ids. It carries
a short `TABLE_FEATURES` list: two features are printed as tables whose cells a
column reader cannot put back into reading order, so their text is written out there.
Each one is checked against what the reader did extract, so a later SRD edit makes the
script complain rather than silently keep stale text.

## Why bbox instead of plain text

Two properties of this PDF break naive extraction, and both are handled here:

- **Columns.** `pdftotext -layout` puts side-by-side columns on the same line and
  loses the boundary wherever a full-width heading bridges the gutter, which
  interleaves adjacent stat blocks. `geo.mjs` reads word coordinates and rebuilds
  columns geometrically instead.
- **Digits.** The italic stat font is a subset with no `ToUnicode` map, so its digits
  extract as Private Use Area codepoints. `glyphs.mjs` maps them back. Every mapping
  was confirmed against a rendered page image, and `assertNoPua` throws on any
  unmapped PUA character so a new glyph can never silently corrupt a number.

## Locales

The scripts write English (the SRD's language) to `../data/en/`. `../data/es/` is a
hand-maintained translation with the same files, ids, and order; the test suite
asserts id parity between the two.
