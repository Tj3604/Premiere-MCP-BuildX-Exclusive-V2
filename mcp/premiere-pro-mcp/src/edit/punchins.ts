/**
 * Punch-in suggestions from WhisperX word timings: a slow eased push from the
 * clip's own scale to ~110% on an emphasis word or a sentence start, held to the
 * end of the phrase, then eased back.
 *
 * Optional pass — the first build has no punch-ins. Every suggestion starts
 * unapproved. Per editorial.md, a punch-in is a secondary layer only, never a
 * fake second camera angle.
 */

import type { TimedWord } from './cleanup.js';

export interface PunchIn {
  id: number;
  /** The word the push lands on. */
  word: string;
  /** Why it was picked. */
  reason: string;
  score: number;
  /** Ease-in starts (source seconds). */
  rampInStart: number;
  /** Fully in — the trigger word's start. */
  inAt: number;
  /** Starts easing back out. */
  holdEnd: number;
  /** Back at the clip's own scale. */
  rampOutEnd: number;
  /** The phrase covered, for the review sheet. */
  phrase: string;
  approved: boolean;
}

export interface PunchOptions {
  /** Seconds between punch-ins, at least. */
  minGapSeconds?: number;
  /** Length of each ease. */
  easeSeconds?: number;
  /** Longest a punch-in holds before easing out. */
  maxHoldSeconds?: number;
  /** A gap this long before a word makes it a sentence start. */
  pauseSeconds?: number;
}

export const DEFAULT_MIN_GAP_SECONDS = 4;
export const DEFAULT_EASE_SECONDS = 0.3;
export const DEFAULT_MAX_HOLD_SECONDS = 3;
export const DEFAULT_PUNCH_SCALE_PERCENT = 110;

const NUMBER_WORDS = new Set([
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twelve', 'fifteen', 'twenty',
  'thirty', 'forty', 'fifty', 'hundred', 'thousand', 'million', 'half', 'double', 'twice'
]);
const STAKES_WORDS = new Set([
  'never', 'always', 'every', 'only', 'biggest', 'most', 'best', 'worst', 'cheapest', 'exactly', 'zero',
  'free', 'mistake', 'huge', 'perfect', 'nobody', 'everyone', 'everything', 'nothing', 'must', 'guaranteed',
  'first', 'last', 'important', 'problem', 'secret', 'wrong'
]);

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9$%']/g, '');
}

function endsSentence(text: string): boolean {
  return /[.?!]["')\]]?$/.test(text.trim());
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function scoreWord(words: TimedWord[], i: number, pause: number): { score: number; reason: string } {
  const raw = words[i]!.text;
  const w = norm(raw);
  if (/\d|\$|%/.test(raw)) return { score: 3, reason: `number "${raw.trim()}"` };
  if (NUMBER_WORDS.has(w)) return { score: 3, reason: `number "${raw.trim()}"` };
  if (STAKES_WORDS.has(w)) return { score: 2, reason: `stakes word "${raw.trim()}"` };
  const prev = words[i - 1];
  if (i > 0 && prev && (endsSentence(prev.text) || words[i]!.start - prev.end >= pause)) {
    return { score: 1, reason: 'sentence start' };
  }
  return { score: 0, reason: '' };
}

/** Where the phrase containing word i ends: sentence end, a pause, or maxHold. */
function phraseEnd(words: TimedWord[], i: number, pause: number, maxHold: number): number {
  const startAt = words[i]!.start;
  let j = i;
  while (j < words.length - 1) {
    const w = words[j]!;
    if (endsSentence(w.text)) break;
    if (words[j + 1]!.start - w.end >= pause) break;
    if (words[j + 1]!.end - startAt > maxHold) break;
    j++;
  }
  return j;
}

export function suggestPunchIns(words: TimedWord[], options: PunchOptions = {}): PunchIn[] {
  const minGap = options.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS;
  const ease = options.easeSeconds ?? DEFAULT_EASE_SECONDS;
  const maxHold = options.maxHoldSeconds ?? DEFAULT_MAX_HOLD_SECONDS;
  const pause = options.pauseSeconds ?? 0.6;

  const candidates = words
    .map((_, i) => ({ i, ...scoreWord(words, i, pause) }))
    .filter((c) => c.score > 0 && words[c.i]!.start >= ease);
  // Strongest first, earlier wins a tie; then keep each pick minGap from the others.
  candidates.sort((a, b) => b.score - a.score || words[a.i]!.start - words[b.i]!.start);
  const picked: typeof candidates = [];
  for (const c of candidates) {
    const t = words[c.i]!.start;
    if (picked.every((p) => Math.abs(words[p.i]!.start - t) >= minGap)) picked.push(c);
  }
  picked.sort((a, b) => words[a.i]!.start - words[b.i]!.start);

  const out: PunchIn[] = [];
  for (let k = 0; k < picked.length; k++) {
    const { i, score, reason } = picked[k]!;
    const last = phraseEnd(words, i, pause, maxHold);
    const inAt = words[i]!.start;
    let holdEnd = Math.max(words[last]!.end, inAt + ease);
    // Never run into the next punch-in's ease.
    const next = picked[k + 1];
    if (next) holdEnd = Math.min(holdEnd, words[next.i]!.start - 2 * ease);
    if (holdEnd <= inAt) continue;
    out.push({
      id: 0,
      word: words[i]!.text.trim(),
      reason,
      score,
      rampInStart: round(inAt - ease),
      inAt: round(inAt),
      holdEnd: round(holdEnd),
      rampOutEnd: round(holdEnd + ease),
      phrase: words.slice(i, last + 1).map((w) => w.text).join(' '),
      approved: false
    });
  }
  return out.map((p, n) => ({ ...p, id: n + 1 }));
}

/** The four Scale keyframes for one punch-in, relative to the clip's own scale. */
export function punchKeyframes(p: PunchIn, baseScale: number, punchPercent: number): Array<{ time: number; value: number }> {
  const punched = round((baseScale * punchPercent) / 100);
  return [
    { time: p.rampInStart, value: baseScale },
    { time: p.inAt, value: punched },
    { time: p.holdEnd, value: punched },
    { time: p.rampOutEnd, value: baseScale }
  ];
}

function tc(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')}`;
}

export function punchInsMarkdown(name: string, list: PunchIn[], punchPercent: number): string {
  const lines = [
    `> Punch-in suggestions for ${name}: eased ${punchPercent}% pushes on emphasis words and sentence starts. Optional — none are approved or applied until you choose.`,
    '',
    `# Punch-ins — ${name}`,
    '',
    `${list.length} suggestions. Pick with apply_punch_ins (ids), e.g. "apply punch-ins 2,5 to clip <id>".`,
    '',
    '| # | At | Holds | Why | Phrase |',
    '|---|---|---|---|---|'
  ];
  for (const p of list) {
    lines.push(
      `| ${p.id} | ${tc(p.inAt)} | ${round(p.holdEnd - p.inAt)}s | ${p.reason} | ${p.phrase.replace(/\|/g, '\\|')} |`
    );
  }
  return lines.join('\n') + '\n';
}
