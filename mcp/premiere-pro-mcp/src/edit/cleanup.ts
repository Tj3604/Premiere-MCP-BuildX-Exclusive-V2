/**
 * Silence and filler cut list from WhisperX word timings.
 *
 * Produces suggestions only — nothing here touches Premiere. Each suggestion is a
 * source range to remove, marked `cut` (safe to take) or `review` (often a real
 * word: "like", "you know"). Approved suggestions become keep-ranges for
 * scripts/plan-cut.mjs, which owns all frame math.
 *
 * Whisper tends to drop "um"/"uh" from its text, so a hesitation usually shows up
 * here as a pause rather than a filler. Both end up in the list.
 */

export interface TimedWord {
  text: string;
  start: number;
  end: number;
  score?: number;
}

export type CutKind = 'pause' | 'filler';
export type CutAction = 'cut' | 'review';

export interface CutSuggestion {
  id: number;
  kind: CutKind;
  action: CutAction;
  start: number;
  end: number;
  seconds: number;
  /** The filler words, or "" for a pause. */
  text: string;
  reason: string;
  before: string;
  after: string;
  /** Pre-set from action: cut = true, review = false. Edit before applying. */
  approved: boolean;
}

export interface CutOptions {
  /** A gap longer than this between words is a pause. */
  minPauseSeconds?: number;
  /** Silence left in place where a pause or filler is removed, split across both sides. */
  keepPauseSeconds?: number;
  /** Media length, so trailing silence after the last word can be cut. */
  durationSeconds?: number;
}

export const DEFAULT_MIN_PAUSE_SECONDS = 0.6;
export const DEFAULT_KEEP_PAUSE_SECONDS = 0.15;

const CUT_FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'mm']);
const REVIEW_FILLERS = new Set(['like']);
const REVIEW_PHRASES: string[][] = [['you', 'know']];

const CONTEXT_WORDS = 4;

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z']/g, '');
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function context(words: TimedWord[], from: number, to: number): { before: string; after: string } {
  return {
    before: words.slice(Math.max(0, from - CONTEXT_WORDS), from).map((w) => w.text).join(' '),
    after: words.slice(to + 1, to + 1 + CONTEXT_WORDS).map((w) => w.text).join(' ')
  };
}

/** Reads a WhisperX words array, or an object holding one. */
export function wordsFrom(value: unknown): TimedWord[] {
  const list = Array.isArray(value) ? value : (value as any)?.words;
  if (!Array.isArray(list)) throw new Error('Expected a WhisperX .words.json array');
  return list
    .map((w: any) => ({ text: String(w.text ?? w.word ?? ''), start: Number(w.start), end: Number(w.end), score: w.score }))
    .filter((w) => w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
}

export function findCuts(words: TimedWord[], options: CutOptions = {}): CutSuggestion[] {
  const minPause = options.minPauseSeconds ?? DEFAULT_MIN_PAUSE_SECONDS;
  const keep = options.keepPauseSeconds ?? DEFAULT_KEEP_PAUSE_SECONDS;
  const half = keep / 2;
  const raw: Omit<CutSuggestion, 'id' | 'seconds' | 'approved'>[] = [];

  // Fillers: one word, or a phrase like "you know". The range eats the gaps either
  // side so removing it does not leave two silences back to back.
  const isFiller = new Array(words.length).fill(false);
  for (let i = 0; i < words.length; i++) {
    let len = 0;
    let action: CutAction = 'review';
    const w = norm(words[i]!.text);
    if (CUT_FILLERS.has(w)) {
      len = 1;
      action = 'cut';
    } else if (REVIEW_FILLERS.has(w)) {
      len = 1;
    } else {
      const phrase = REVIEW_PHRASES.find((p) => p.every((pw, k) => words[i + k] && norm(words[i + k]!.text) === pw));
      if (phrase) len = phrase.length;
    }
    if (len === 0) continue;
    const last = i + len - 1;
    const prev = words[i - 1];
    const next = words[last + 1];
    const start = prev ? Math.min(words[i]!.start, prev.end + half) : words[i]!.start;
    const end = next ? Math.max(words[last]!.end, next.start - half) : words[last]!.end;
    const text = words.slice(i, last + 1).map((x) => x.text).join(' ');
    raw.push({
      kind: 'filler',
      action,
      start,
      end,
      text,
      reason: action === 'cut' ? `filler "${text}"` : `"${text}" — often a real word, check it`,
      ...context(words, i, last)
    });
    for (let k = i; k <= last; k++) isFiller[k] = action === 'cut';
    i = last;
  }

  // Pauses between words (and before the first / after the last word).
  const gaps: Array<{ from: number; to: number; start: number; end: number }> = [];
  if (words.length > 0) {
    gaps.push({ from: -1, to: 0, start: 0, end: words[0]!.start });
    for (let i = 0; i < words.length - 1; i++) gaps.push({ from: i, to: i + 1, start: words[i]!.end, end: words[i + 1]!.start });
    if (options.durationSeconds !== undefined) {
      gaps.push({ from: words.length - 1, to: words.length, start: words[words.length - 1]!.end, end: options.durationSeconds });
    }
  }
  for (const g of gaps) {
    if (g.end - g.start <= minPause) continue;
    // A taken filler next to this gap already removes it.
    if ((g.from >= 0 && isFiller[g.from]) || (g.to < words.length && isFiller[g.to])) continue;
    const lead = g.from < 0;
    const tail = g.to >= words.length;
    const start = lead ? 0 : g.start + half;
    const end = tail ? g.end : g.end - half;
    raw.push({
      kind: 'pause',
      action: 'cut',
      start,
      end,
      text: '',
      reason: `${round(g.end - g.start)}s ${lead ? 'before the first word' : tail ? 'after the last word' : 'pause'}`,
      before: lead ? '' : words.slice(Math.max(0, g.from - CONTEXT_WORDS + 1), g.from + 1).map((w) => w.text).join(' '),
      after: tail ? '' : words.slice(g.to, g.to + CONTEXT_WORDS).map((w) => w.text).join(' ')
    });
  }

  return raw
    .filter((r) => r.end - r.start > 0.001)
    .sort((a, b) => a.start - b.start)
    .map((r, i) => ({
      ...r,
      id: i + 1,
      start: round(r.start),
      end: round(r.end),
      seconds: round(r.end - r.start),
      approved: r.action === 'cut'
    }));
}

export interface CutSummary {
  suggestions: number;
  cut: number;
  review: number;
  cutSeconds: number;
  reviewSeconds: number;
  sourceSeconds: number;
}

export function summarize(cuts: CutSuggestion[], sourceSeconds: number): CutSummary {
  const sum = (xs: CutSuggestion[]) => round(xs.reduce((a, c) => a + c.seconds, 0));
  const cut = cuts.filter((c) => c.action === 'cut');
  const review = cuts.filter((c) => c.action === 'review');
  return {
    suggestions: cuts.length,
    cut: cut.length,
    review: review.length,
    cutSeconds: sum(cut),
    reviewSeconds: sum(review),
    sourceSeconds: round(sourceSeconds)
  };
}

/** Keep-ranges for plan-cut: [0, duration] minus every approved cut. */
export function keepRanges(cuts: CutSuggestion[], durationSeconds: number): Array<{ start: number; end: number }> {
  const removed = cuts
    .filter((c) => c.approved)
    .map((c) => ({ start: Math.max(0, c.start), end: Math.min(durationSeconds, c.end) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const keeps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const r of removed) {
    if (r.start > cursor) keeps.push({ start: round(cursor), end: round(r.start) });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < durationSeconds) keeps.push({ start: round(cursor), end: round(durationSeconds) });
  return keeps;
}

function tc(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** The human review sheet. */
export function cutsMarkdown(name: string, cuts: CutSuggestion[], summary: CutSummary): string {
  const lines = [
    `> Cut list for ${name}: pauses and fillers found in the WhisperX word timings. Suggestions only — nothing has been cut.`,
    '',
    `# Cuts — ${name}`,
    '',
    `${summary.cut} to cut (${summary.cutSeconds}s), ${summary.review} to review (${summary.reviewSeconds}s), from ${summary.sourceSeconds}s of source.`,
    '',
    'Set `approved` in the matching .cuts.json (or pass --approve / --reject ids), then run find-cuts with --apply.',
    '',
    '| # | Action | At | Length | Why | Context |',
    '|---|---|---|---|---|---|'
  ];
  for (const c of cuts) {
    const ctx = `${c.before} **[${c.text || '…'}]** ${c.after}`.replace(/\|/g, '\\|').trim();
    lines.push(`| ${c.id} | ${c.action} | ${tc(c.start)} | ${c.seconds}s | ${c.reason} | ${ctx} |`);
  }
  return lines.join('\n') + '\n';
}
