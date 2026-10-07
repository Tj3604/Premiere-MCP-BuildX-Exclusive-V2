/**
 * YouTube Studio "Table data.csv" -> library performance numbers.
 *
 * Studio's Advanced-mode export (Export current view -> CSV) is a zip holding
 * Table data.csv. Its columns depend on the metrics ticked, so they are found by
 * header text, not position. Needed: a title column and a views column. Used when
 * present: Content (video ID), Video publish time, Average view duration,
 * Average percentage viewed (%), Stayed to watch (%).
 *
 * Rows are matched to entries by YouTube ID first (once a link is stored), then by
 * title. Library titles are delivery filenames ("Short 07 - The Living Room"),
 * YouTube titles are publish titles, so the title match is fuzzy and refuses to
 * guess when two entries score alike.
 */

import type { VideoEntry } from './index.js';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface StudioRow {
  videoId: string | null;
  title: string;
  publishDate: string | null;
  views: number;
  avgViewDurationSeconds: number | null;
  retentionPercent: number | null;
  stayedToWatchPercent: number | null;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const t = raw.replace(/[,%\s]/g, '');
  if (t === '' || t === '—' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "0:00:23", "1:05", or plain seconds. */
export function parseDuration(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '' || raw.trim() === '—') return null;
  const parts = raw.trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** "Sep 22, 2026" or "2026-09-22" -> "2026-09-22". */
export function parseStudioDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(t);
  if (m && MONTHS[m[1]!.toLowerCase()]) return `${m[3]}-${MONTHS[m[1]!.toLowerCase()]}-${m[2]!.padStart(2, '0')}`;
  return null;
}

function findColumn(header: string[], ...needles: string[]): number {
  const h = header.map((c) => c.toLowerCase().trim());
  for (const needle of needles) {
    const i = h.findIndex((c) => c === needle);
    if (i >= 0) return i;
  }
  for (const needle of needles) {
    const i = h.findIndex((c) => c.includes(needle));
    if (i >= 0) return i;
  }
  return -1;
}

export function readStudioTable(text: string): { rows: StudioRow[]; columns: Record<string, string | null> } {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error('CSV has no data rows');
  const header = table[0]!;
  const col = {
    videoId: findColumn(header, 'content', 'video id'),
    title: findColumn(header, 'video title', 'title'),
    publish: findColumn(header, 'video publish time', 'publish'),
    views: findColumn(header, 'views'),
    avd: findColumn(header, 'average view duration'),
    apv: findColumn(header, 'average percentage viewed'),
    stayed: findColumn(header, 'stayed to watch')
  };
  if (col.title < 0) throw new Error(`No title column in: ${header.join(', ')}`);
  if (col.views < 0) throw new Error(`No views column in: ${header.join(', ')}`);

  const at = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);
  const rows: StudioRow[] = [];
  for (const r of table.slice(1)) {
    const title = (at(r, col.title) ?? '').trim();
    const id = (at(r, col.videoId) ?? '').trim();
    // Studio puts a "Total" row first.
    if (!title || id.toLowerCase() === 'total' || title.toLowerCase() === 'total') continue;
    const views = num(at(r, col.views));
    if (views === null) continue;
    rows.push({
      videoId: /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null,
      title,
      publishDate: parseStudioDate(at(r, col.publish)),
      views: Math.round(views),
      avgViewDurationSeconds: parseDuration(at(r, col.avd)),
      retentionPercent: num(at(r, col.apv)),
      stayedToWatchPercent: num(at(r, col.stayed))
    });
  }
  const name = (i: number) => (i >= 0 ? header[i]! : null);
  return {
    rows,
    columns: {
      videoId: name(col.videoId),
      title: name(col.title),
      publishDate: name(col.publish),
      views: name(col.views),
      avgViewDuration: name(col.avd),
      averagePercentageViewed: name(col.apv),
      stayedToWatch: name(col.stayed)
    }
  };
}

const TITLE_NOISE = /#\w+|\b(?:short|shorts|buildx|adu)\b|\bs\d+\s+\d+\b|\br\d+\b|\b\d+\b/g;

export function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[’‘']/g, '')
    .replace(TITLE_NOISE, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);
}

function overlap(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  // Containment, not Jaccard: publish titles often add words to the delivery title.
  return inter / Math.min(sa.size, sb.size);
}

export interface RowMatch {
  row: StudioRow;
  entry: VideoEntry | null;
  how: 'video-id' | 'title' | null;
  score: number;
  /** When unmatched: the best candidates, for a manual --set. */
  candidates: Array<{ slug: string; title: string; score: number }>;
}

export function matchRows(rows: StudioRow[], entries: VideoEntry[], minScore = 0.6, margin = 0.15): RowMatch[] {
  return rows.map((row) => {
    if (row.videoId) {
      const byId = entries.find((e) => (e.platformLinks?.youtube ?? '').includes(row.videoId!));
      if (byId) return { row, entry: byId, how: 'video-id', score: 1, candidates: [] };
    }
    const rw = titleWords(row.title);
    const scored = entries
      .map((e) => ({ e, score: Math.max(overlap(rw, titleWords(e.title)), overlap(rw, titleWords(e.hookLine)) * 0.9) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    const candidates = scored.slice(0, 3).map((s) => ({ slug: s.e.slug, title: s.e.title, score: Number(s.score.toFixed(2)) }));
    if (best && best.score >= minScore && (!second || best.score - second.score >= margin)) {
      return { row, entry: best.e, how: 'title', score: Number(best.score.toFixed(2)), candidates: [] };
    }
    return { row, entry: null, how: null, score: best ? Number(best.score.toFixed(2)) : 0, candidates };
  });
}

/** Writes a Studio row's numbers onto an entry copy. `window` picks the views field. */
export function applyStudioRow(entry: VideoEntry, row: StudioRow, window: '7d' | '30d', asOf: string): VideoEntry {
  const next: VideoEntry = JSON.parse(JSON.stringify(entry));
  if (window === '7d') next.performance.views7d = row.views;
  else next.performance.views30d = row.views;
  if (row.avgViewDurationSeconds !== null) next.performance.avgViewDurationSeconds = row.avgViewDurationSeconds;
  if (row.retentionPercent !== null) next.performance.retentionPercent = row.retentionPercent;
  if (row.stayedToWatchPercent !== null) next.performance.stayedToWatchPercent = row.stayedToWatchPercent;
  next.performance.measuredAt = asOf;
  if (row.publishDate && !next.publishDate) next.publishDate = row.publishDate;
  if (row.videoId && !next.platformLinks.youtube) next.platformLinks.youtube = `https://www.youtube.com/watch?v=${row.videoId}`;
  return next;
}
