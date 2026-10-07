/**
 * Hook bank: rank past hooks by how well they held, and catch a new hook that is
 * too close to one already posted or queued.
 *
 * Ranking follows the channel lesson in reference_youtube_studio_hook_metrics:
 * never trust a rate on a handful of views — anything under the view floor is
 * listed separately, not ranked.
 */

import type { VideoEntry } from './index.js';

export type HookSortKey = 'retention' | 'stayedToWatch' | 'views30d';

export const DEFAULT_MIN_VIEWS = 150;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.6;
const OPENING_WORDS = 4;

// Spoken filler only — hooks are short, so ordinary words carry the meaning.
const FILLER = new Set(['um', 'uh', 'uhm', 'erm', 'so', 'like', 'okay', 'ok', 'well', 'yeah', 'oh']);
const FILLER_PHRASES = [/\byou know\b/g, /\bi mean\b/g, /\bkind of\b/g, /\bsort of\b/g];

export function normalizeHook(hook: string): string[] {
  let s = hook.toLowerCase().replace(/[’‘]/g, "'");
  for (const phrase of FILLER_PHRASES) s = s.replace(phrase, ' ');
  return s
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w && !FILLER.has(w));
}

function trigrams(words: string[]): Map<string, number> {
  const s = ` ${words.join(' ')} `;
  const grams = new Map<string, number>();
  for (let i = 0; i < s.length - 2; i++) {
    const g = s.slice(i, i + 3);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let overlap = 0;
  let total = 0;
  for (const [g, n] of a) {
    overlap += Math.min(n, b.get(g) ?? 0);
    total += n;
  }
  for (const n of b.values()) total += n;
  return total === 0 ? 0 : (2 * overlap) / total;
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export interface HookSimilarity {
  score: number;
  sameOpening: boolean;
}

/**
 * Max of word overlap (catches reordering) and character-trigram overlap (catches
 * rewording like "builder" / "builders", "can't" / "cannot").
 */
export function hookSimilarity(a: string, b: string): HookSimilarity {
  const wa = normalizeHook(a);
  const wb = normalizeHook(b);
  const score = Math.max(jaccard(wa, wb), dice(trigrams(wa), trigrams(wb)));
  const sameOpening =
    wa.length >= OPENING_WORDS &&
    wb.length >= OPENING_WORDS &&
    wa.slice(0, OPENING_WORDS).join(' ') === wb.slice(0, OPENING_WORDS).join(' ');
  return { score: Number(score.toFixed(3)), sameOpening };
}

export type HookStatus = 'posted' | 'queued';

export function hookStatus(entry: VideoEntry): HookStatus {
  const links = Object.values(entry.platformLinks ?? {}).some((v) => typeof v === 'string' && v.length > 0);
  return entry.publishDate || links ? 'posted' : 'queued';
}

export interface HookRow {
  slug: string;
  title: string;
  hookLine: string;
  status: HookStatus;
  publishDate: string | null;
  views: number | null;
  retentionPercent: number | null;
  stayedToWatchPercent: number | null;
  views30d: number | null;
}

function toRow(e: VideoEntry): HookRow {
  const p = e.performance;
  return {
    slug: e.slug,
    title: e.title,
    hookLine: e.hookLine,
    status: hookStatus(e),
    publishDate: e.publishDate,
    views: p.views30d ?? p.views7d,
    retentionPercent: p.retentionPercent,
    stayedToWatchPercent: p.stayedToWatchPercent,
    views30d: p.views30d
  };
}

function metric(row: HookRow, key: HookSortKey): number | null {
  if (key === 'retention') return row.retentionPercent;
  if (key === 'stayedToWatch') return row.stayedToWatchPercent;
  return row.views30d;
}

export interface HookBank {
  sortBy: HookSortKey;
  minViews: number;
  ranked: Array<HookRow & { rank: number }>;
  /** Measured, but on fewer views than the floor — rates this small are noise. */
  belowViewFloor: HookRow[];
  /** No number for the sort metric yet. */
  unmeasured: HookRow[];
}

export function buildHookBank(entries: VideoEntry[], sortBy: HookSortKey, minViews: number, limit: number): HookBank {
  const rows = entries.filter((e) => e.hookLine.trim()).map(toRow);
  const unmeasured = rows.filter((r) => metric(r, sortBy) === null);
  const measured = rows.filter((r) => metric(r, sortBy) !== null);
  // views30d is itself the volume, so the floor only guards the rate metrics.
  const floorApplies = sortBy !== 'views30d';
  const belowViewFloor = floorApplies ? measured.filter((r) => (r.views ?? 0) < minViews) : [];
  const eligible = floorApplies ? measured.filter((r) => (r.views ?? 0) >= minViews) : measured;
  const ranked = eligible
    .sort((a, b) => (metric(b, sortBy) ?? 0) - (metric(a, sortBy) ?? 0))
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, ...r }));
  return { sortBy, minViews, ranked, belowViewFloor, unmeasured };
}

export interface HookMatch extends HookRow {
  similarity: number;
  sameOpening: boolean;
}

export interface HookCheck {
  hook: string;
  threshold: number;
  tooClose: boolean;
  warning: string | null;
  closest: HookMatch[];
}

export function checkHook(hook: string, entries: VideoEntry[], threshold: number, limit: number): HookCheck {
  const matches: HookMatch[] = entries
    .filter((e) => e.hookLine.trim())
    .map((e) => {
      const sim = hookSimilarity(hook, e.hookLine);
      return { ...toRow(e), similarity: sim.score, sameOpening: sim.sameOpening };
    })
    .sort((a, b) => b.similarity - a.similarity || Number(b.sameOpening) - Number(a.sameOpening));

  const offenders = matches.filter((m) => m.similarity >= threshold || m.sameOpening);
  const closest = [...offenders, ...matches.filter((m) => !offenders.includes(m))].slice(0, Math.max(limit, offenders.length));

  let warning: string | null = null;
  if (offenders.length > 0) {
    const top = offenders[0]!;
    const why = top.similarity >= threshold ? `${Math.round(top.similarity * 100)}% similar` : `opens with the same ${OPENING_WORDS} words`;
    warning = `Too close to the ${top.status} hook "${top.hookLine}" (${top.title}) — ${why}.${offenders.length > 1 ? ` ${offenders.length - 1} more match${offenders.length > 2 ? 'es' : ''} below.` : ''}`;
  }
  return { hook, threshold, tooClose: offenders.length > 0, warning, closest };
}
