import fs from 'node:fs';
import { fixGlyphs, assertNoPua } from './glyphs.mjs';

/**
 * Reads pdftotext's -bbox-layout XML. Poppler already groups words into blocks and
 * lines with coordinates, so columns never interleave the way `-layout` text does.
 *
 * Returns pages[] of columns[] of lines[], columns ordered left to right.
 */

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

const clean = (s) =>
  fixGlyphs(s)
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/[ﬀ-ﬄ]/g, (c) => LIGATURES[c] ?? c);

/**
 * Same extraction as `readPages`, but keeps each block's coordinates so callers can
 * align rows across table columns by their y position.
 */
export function readBlocks(xmlPath) {
  return readPages(xmlPath, { withCoords: true });
}

export function readPages(xmlPath, { withCoords = false } = {}) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const pages = [];

  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  let pageMatch;
  while ((pageMatch = pageRe.exec(xml)) !== null) {
    const body = pageMatch[3];

    const blocks = [];
    const blockRe = /<block xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([\s\S]*?)<\/block>/g;
    let blockMatch;
    while ((blockMatch = blockRe.exec(body)) !== null) {
      const xMin = Number(blockMatch[1]);
      const yMin = Number(blockMatch[2]);
      const lines = [];
      const lineRe = /<line [^>]*>([\s\S]*?)<\/line>/g;
      let lineMatch;
      while ((lineMatch = lineRe.exec(blockMatch[3])) !== null) {
        const words = [
          ...lineMatch[1].matchAll(
            /<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g,
          ),
        ].map((w) => ({ xMin: Number(w[1]), xMax: Number(w[2]), text: clean(w[3]) }));

        // Poppler emits a ligature as its own <word>, which would turn "Difficulty"
        // into "Diffi culty". Only insert a space where the glyphs actually gap.
        let text = '';
        let prev = null;
        for (const word of words) {
          if (prev !== null && word.xMin - prev.xMax > 0.6) text += ' ';
          text += word.text;
          prev = word;
        }
        text = text.replace(/\s+/g, ' ').trim();
        if (text !== '') lines.push(text);
      }
      if (lines.length > 0) blocks.push({ xMin, yMin, lines });
    }

    // Group blocks into columns by their left edge, then read each column top-down.
    const xs = [...new Set(blocks.map((b) => Math.round(b.xMin)))].sort((a, b) => a - b);
    const cuts = [];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] > 30) cuts.push((xs[i] + xs[i - 1]) / 2);
    }
    const columnOf = (x) => cuts.reduce((c, cut) => (x >= cut ? c + 1 : c), 0);

    const byColumn = new Map();
    for (const block of blocks) {
      const c = columnOf(block.xMin);
      if (!byColumn.has(c)) byColumn.set(c, []);
      byColumn.get(c).push(block);
    }

    pages.push(
      [...byColumn.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, colBlocks]) => {
          const sorted = colBlocks.sort((a, b) => a.yMin - b.yMin);
          return withCoords ? sorted : sorted.flatMap((b) => b.lines);
        }),
    );
  }

  assertNoPua(pages.flat(2).join('\n'), xmlPath);
  return pages;
}
