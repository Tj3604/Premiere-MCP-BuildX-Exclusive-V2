/**
 * BuildX caption cues from WhisperX word timings (captions.md: word-level data is
 * authoritative for timing).
 *
 * Single-line cues fitted by measured width at Thomas Default (Poppins Bold 75),
 * not character count: Premiere's caption box wraps at ~780px, so 745px is the
 * ceiling. Cues never overlap — overlapping cues render stacked as two lines and
 * Premiere merges them. The first cue starts no earlier than frame 1, clear of
 * the designed thumbnail card. Words are never changed; doubtful ones are flagged.
 */

import type { TimedWord } from '../edit/cleanup.js';
import { POPPINS_BOLD } from './poppins-bold.js';

export interface Cue {
  index: number;
  start: number;
  end: number;
  text: string;
  widthPx: number;
}

export interface CaptionOptions {
  maxWidthPx?: number;
  fontPx?: number;
  /** Cues are stretched toward this where the next cue leaves room. Not a floor. */
  minSeconds?: number;
  /** Space kept between one cue's end and the next start. */
  gapSeconds?: number;
  /** A pause this long always ends a cue. */
  pauseSeconds?: number;
  /** Nothing before this — frame 1 at 29.97 by default, past the thumbnail card. */
  firstStartSeconds?: number;
}

export const DEFAULT_MAX_WIDTH_PX = 745;
export const FRAME_2997 = 1001 / 30000;

export function textWidth(text: string, fontPx = 75): number {
  const { advances, unitsPerEm } = POPPINS_BOLD;
  const fallback = advances['n'] ?? 600;
  let units = 0;
  for (const ch of text) units += advances[ch] ?? fallback;
  return (units * fontPx) / unitsPerEm;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const SENTENCE_END = /[.?!]["')\]]?$/;
const CLAUSE_END = /[,;:]["')\]]?$/;

/**
 * Splits one segment into the fewest lines that fit maxW, choosing break points
 * that minimise the widest line, with a small bonus for breaking after a comma.
 */
export function balance(segment: TimedWord[], maxW: number, font = 75): TimedWord[][] {
  const n = segment.length;
  const width = (a: number, b: number) => textWidth(segment.slice(a, b).map((w) => w.text).join(' '), font);
  if (width(0, n) <= maxW) return [segment];
  // dp[i] = best [lines, cost] for words i..n-1; cost = widest line minus comma bonus.
  const best: Array<{ lines: number; cost: number; next: number } | null> = new Array(n + 1).fill(null);
  best[n] = { lines: 0, cost: 0, next: n };
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j <= n; j++) {
      const w = width(i, j);
      if (w > maxW && j > i + 1) break;
      const rest = best[j];
      if (!rest) continue;
      const bonus = j < n && CLAUSE_END.test(segment[j - 1]!.text) ? 60 : 0;
      const cand = { lines: rest.lines + 1, cost: Math.max(w - bonus, rest.cost), next: j };
      const cur = best[i];
      if (!cur || cand.lines < cur.lines || (cand.lines === cur.lines && cand.cost < cur.cost)) best[i] = cand;
    }
  }
  const out: TimedWord[][] = [];
  for (let i = 0; i < n; i = best[i]!.next) out.push(segment.slice(i, best[i]!.next));
  return out;
}

export function buildCues(words: TimedWord[], options: CaptionOptions = {}): Cue[] {
  const maxW = options.maxWidthPx ?? DEFAULT_MAX_WIDTH_PX;
  const font = options.fontPx ?? 75;
  const minS = options.minSeconds ?? 1.2;
  const gap = options.gapSeconds ?? 0.05;
  const pause = options.pauseSeconds ?? 0.6;
  const first = options.firstStartSeconds ?? FRAME_2997;

  // Segments first: a sentence end or a pause always ends a caption. Then each
  // segment is split into as few lines as fit, balanced so no line is an orphan.
  const lineText = (ws: TimedWord[]) => ws.map((w) => w.text).join(' ');
  const clean = words.map((w) => ({ ...w, text: w.text.trim() })).filter((w) => w.text);
  const segments: TimedWord[][] = [];
  let seg: TimedWord[] = [];
  for (let i = 0; i < clean.length; i++) {
    const w = clean[i]!;
    const prev = seg[seg.length - 1];
    if (prev && (SENTENCE_END.test(prev.text) || w.start - prev.end >= pause)) {
      segments.push(seg);
      seg = [];
    }
    seg.push(w);
  }
  if (seg.length) segments.push(seg);

  const groups: TimedWord[][] = [];
  for (const segment of segments) groups.push(...balance(segment, maxW, font));
  // Timing: start on the first word, end on the last, then a strict monotonic pass.
  const cues = groups.map((g) => ({ start: g[0]!.start, end: g[g.length - 1]!.end, text: lineText(g) }));
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    const next = cues[i + 1];
    if (i === 0 && c.start < first) c.start = Math.min(first, c.end - 0.05);
    if (c.end - c.start < minS) c.end = Math.max(c.end, c.start + minS);
    if (next) {
      // Never run into the next cue; push the next start later only if it must.
      if (next.start < c.start + 0.1) next.start = c.start + 0.1;
      c.end = Math.min(c.end, next.start - gap);
      if (c.end <= c.start) c.end = c.start + 0.05;
      if (next.start < c.end + gap) next.start = c.end + gap;
    }
  }
  return cues.map((c, n) => ({ index: n + 1, start: round(c.start), end: round(c.end), text: c.text, widthPx: Math.round(textWidth(c.text, font)) }));
}

/** Every pair checked: a cue must end before the next starts. */
export function overlaps(cues: Cue[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 1; i < cues.length; i++) if (cues[i]!.start < cues[i - 1]!.end) out.push([cues[i - 1]!.index, cues[i]!.index]);
  return out;
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c) => `${c.index}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

export interface CaptionFlag {
  cue: number;
  at: number;
  text: string;
  reason: string;
}

export interface Lexicon {
  /** Phrases the transcript has produced wrongly before, with what to check. */
  phrases: Array<{ produced: string; note: string }>;
}

/**
 * Reads the "Transcript produced" column of every table in terminology.md's
 * Transcription lexicon section. Read-only use of the knowledge file.
 */
export function parseLexicon(markdown: string): Lexicon {
  const start = markdown.indexOf('## Transcription lexicon');
  if (start < 0) return { phrases: [] };
  const rest = markdown.slice(start + 1);
  const end = rest.indexOf('\n## ');
  const section = end < 0 ? rest : rest.slice(0, end);
  const phrases: Lexicon['phrases'] = [];
  for (const row of section.split('\n')) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length < 4 || /^-+$/.test(cells[1] ?? '') || /transcript/i.test(cells[1] ?? '')) continue;
    const produced = (cells[1] ?? '').replace(/^"|"$/g, '').replace(/[“”"]/g, '').trim();
    if (!produced || produced.length < 2) continue;
    phrases.push({ produced: produced.toLowerCase(), note: (cells[2] ?? '').replace(/\*\*/g, '') });
  }
  return { phrases };
}

/** Flags, never fixes: low-confidence words, lexicon hits, figures, banned wording. */
export function flagCues(cues: Cue[], words: TimedWord[], lexicon: Lexicon, minScore = 0.5): CaptionFlag[] {
  const flags: CaptionFlag[] = [];
  const cueAt = (t: number) => cues.find((c) => t >= c.start - 0.02 && t <= c.end + 0.02) ?? cues.find((c) => c.start >= t) ?? cues[cues.length - 1];
  for (const w of words) {
    if (typeof w.score === 'number' && w.score < minScore) {
      const c = cueAt(w.start);
      if (c) flags.push({ cue: c.index, at: round(w.start), text: w.text.trim(), reason: `low confidence (${w.score.toFixed(2)}) — listen before burning in` });
    }
  }
  const full = cues.map((c) => c.text).join(' ').toLowerCase();
  for (const p of lexicon.phrases) {
    let from = 0;
    for (;;) {
      const i = full.indexOf(p.produced, from);
      if (i < 0) break;
      // Map the hit back to a cue by character position.
      let pos = 0;
      const c = cues.find((cue) => {
        const hit = i >= pos && i <= pos + cue.text.length;
        pos += cue.text.length + 1;
        return hit;
      });
      if (c) flags.push({ cue: c.index, at: c.start, text: p.produced, reason: `known mis-transcription — terminology.md: ${p.note}` });
      from = i + p.produced.length;
    }
  }
  for (const c of cues) {
    if (/\d/.test(c.text)) flags.push({ cue: c.index, at: c.start, text: c.text, reason: 'figure on screen — check verified-facts.md and its qualifiers' });
    if (/\bdrywall\b/i.test(c.text)) flags.push({ cue: c.index, at: c.start, text: 'drywall', reason: 'BuildX walls are thin coat plaster — confirm before this word goes on screen' });
  }
  return flags.sort((a, b) => a.at - b.at);
}

function tc(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')}`;
}

export function captionsMarkdown(name: string, cues: Cue[], flags: CaptionFlag[]): string {
  const widest = cues.reduce((a, c) => Math.max(a, c.widthPx), 0);
  const lines = [
    `> Caption review for ${name}: ${cues.length} single-line cues from WhisperX word timings. No word was changed — check every flag before the captions are burned in (captions.md).`,
    '',
    `# Captions — ${name}`,
    '',
    `${cues.length} cues, widest ${widest}px of ${DEFAULT_MAX_WIDTH_PX}px, ${flags.length} flag${flags.length === 1 ? '' : 's'}.`,
    '',
    'After place_captions: Properties → Track Style → **Thomas Default** (GUI, one click per sequence), and trim caption 1 off frame 0 if Premiere put it there.',
    ''
  ];
  if (flags.length) {
    lines.push('## Check these', '', '| Cue | At | Text | Why |', '|---|---|---|---|');
    for (const f of flags) lines.push(`| ${f.cue} | ${tc(f.at)} | ${f.text.replace(/\|/g, '\\|')} | ${f.reason} |`);
    lines.push('');
  }
  return lines.join('\n');
}
