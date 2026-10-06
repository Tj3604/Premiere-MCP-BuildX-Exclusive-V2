#!/usr/bin/env node
/**
 * Read a TrueType font's advance widths for the characters captions use, so
 * caption lines can be fitted by measured width instead of character count.
 *
 *   node scripts/font-widths.mjs ~/Library/Fonts/Poppins-Bold.ttf   # prints JSON; paste the advances into src/captions/poppins-bold.ts
 *
 * Reads only the cmap (format 4), hmtx, hhea and head tables. Kerning is ignored —
 * the caption fitter keeps a margin under Premiere's measured box for it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/font-widths.mjs <font.ttf>');
  process.exit(2);
}
const buf = readFileSync(file);

const numTables = buf.readUInt16BE(4);
const tables = {};
for (let i = 0; i < numTables; i++) {
  const rec = 12 + i * 16;
  tables[buf.toString('ascii', rec, rec + 4)] = { offset: buf.readUInt32BE(rec + 8) };
}
for (const t of ['cmap', 'hmtx', 'hhea', 'head']) if (!tables[t]) throw new Error(`No ${t} table in ${file}`);

const unitsPerEm = buf.readUInt16BE(tables.head.offset + 18);
const numberOfHMetrics = buf.readUInt16BE(tables.hhea.offset + 34);
const advance = (glyph) => buf.readUInt16BE(tables.hmtx.offset + 4 * Math.min(glyph, numberOfHMetrics - 1));

// Unicode BMP subtable (platform 3 encoding 1, or platform 0), format 4.
const cmap = tables.cmap.offset;
let sub = null;
for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
  const rec = cmap + 4 + i * 8;
  const platform = buf.readUInt16BE(rec);
  const encoding = buf.readUInt16BE(rec + 2);
  const off = cmap + buf.readUInt32BE(rec + 4);
  if (buf.readUInt16BE(off) === 4 && ((platform === 3 && encoding === 1) || platform === 0)) sub = off;
}
if (sub === null) throw new Error('No format-4 Unicode cmap');

const segX2 = buf.readUInt16BE(sub + 6);
const ends = sub + 14;
const starts = ends + segX2 + 2;
const deltas = starts + segX2;
const rangeOffsets = deltas + segX2;
function glyphFor(code) {
  for (let s = 0; s < segX2 / 2; s++) {
    const end = buf.readUInt16BE(ends + 2 * s);
    if (code > end) continue;
    const start = buf.readUInt16BE(starts + 2 * s);
    if (code < start) return 0;
    const delta = buf.readInt16BE(deltas + 2 * s);
    const ro = buf.readUInt16BE(rangeOffsets + 2 * s);
    if (ro === 0) return (code + delta) & 0xffff;
    const g = buf.readUInt16BE(rangeOffsets + 2 * s + ro + 2 * (code - start));
    return g === 0 ? 0 : (g + delta) & 0xffff;
  }
  return 0;
}

const chars = [];
for (let c = 32; c <= 126; c++) chars.push(String.fromCharCode(c));
chars.push(...'’‘“”–—…é'.split(''));
const advances = {};
for (const ch of chars) {
  const g = glyphFor(ch.codePointAt(0));
  if (g) advances[ch] = advance(g);
}

console.log(
  JSON.stringify(
    {
      description: `Advance widths (font units) read from ${path.basename(file)} by scripts/font-widths.mjs. Font metrics only.`,
      font: path.basename(file, path.extname(file)),
      unitsPerEm,
      advances
    },
    null,
    2
  )
);
