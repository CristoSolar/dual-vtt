# SRD extraction

One-time scripts that generated `../data/*.json` from
`Daggerheart-SRD-9-09-25.pdf`. The JSON is committed, so you only need these to
re-derive the data (e.g. against a newer SRD release).

## Regenerating

The scripts read `srd-bbox.xml`, which is produced by poppler's `pdftotext`. It is
not committed. Generate it from the repo root:

```sh
pdftotext -bbox-layout Daggerheart-SRD-9-09-25.pdf packages/srd-data/extract/srd-bbox.xml
```

No poppler installed? Run it in a container instead:

```sh
docker run --rm -v "$PWD:/w" -w /w minidocks/poppler:latest \
  pdftotext -bbox-layout Daggerheart-SRD-9-09-25.pdf packages/srd-data/extract/srd-bbox.xml
```

Then, from this directory:

```sh
for g in gen-weapons gen-armor gen-cards gen-adversaries \
         gen-environments gen-loot gen-beastforms; do node "$g.mjs"; done
```

Each script prints its entry counts and a `problems:` line. **`problems: 0` is the
contract** — any parse anomaly is reported rather than silently dropped or guessed.

`gen-weapons.mjs` and `gen-armor.mjs` differ from the rest: their tables are small
and dense enough that the rows are transcribed inline, so they need no XML.

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
