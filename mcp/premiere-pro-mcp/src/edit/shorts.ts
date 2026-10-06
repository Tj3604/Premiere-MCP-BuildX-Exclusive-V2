/**
 * Short candidates from a long episode's WhisperX words: every 30–60s window
 * that starts and ends on a whole sentence, ranked mostly on its opening line
 * (editorial.md "Hook standards", SHORTS_ENGINE_SPEC.md). Native windows only —
 * exact quotes, nothing intercut.
 *
 * Measured on the channel (hook-performance.md): a specific number beats a
 * category, and "BuildX" in the opening loses. Every candidate starts unapproved.
 */

import type { TimedWord } from './cleanup.js';

export interface ShortCandidate {
  id: number;
  start: number;
  end: number;
  seconds: number;
  hook: string;
  /** Working title from the hook; rename before building. */
  title: string;
  score: number;
  reasons: string[];
  /** Closest past hook when it is too close (from check_hook), else null. */
  closeTo: string | null;
  text: string;
  approved: boolean;
}

export interface ShortOptions {
  minSeconds?: number;
  maxSeconds?: number;
  limit?: number;
  /** A gap this long ends a sentence even without punctuation. */
  pauseSeconds?: number;
}

export interface Sentence {
  from: number;
  to: number;
  start: number;
  end: number;
  text: string;
}

const WEAK_OPENERS = new Set(['so', 'and', 'but', 'yeah', 'yes', 'um', 'uh', 'like', 'okay', 'ok', 'well', 'right', 'because', 'cause', 'cuz', 'or', 'then', 'also', 'oh', 'no']);
const WEAK_OPENING_PHRASES = /^(i mean|you know|i think|i guess|kind of|sort of|let me|let's see|alright|all right)\b/i;
const CONTRADICTION = /\b(never|don'?t|doesn'?t|isn'?t|wrong|myth|actually|mistake|no idea|nobody|most people|stop|biggest)\b/i;
/** Shoot chatter: crew directions and mic checks are not content. */
const PRODUCTION_CHATTER = /\b(camera (one|two|three|four|five|a|b|\d)|on camera|rolling|speed|mic check|sound check|double[- ]check|one more time|from the top|pick it up|cut\b|action\b|look at me|look here|you're good|got the recording|are we rolling|recording)\b/i;
const STAKES = /\b(cost|costs|money|price|paid|pay|lose|lost|torn down|illegal|law|permit|fine|fail|failed|problem|risk|afford|cheaper|expensive|budget|tax|value)\b/i;
/** A street address is personal information, never a hook. */
const ADDRESS = /\b\d+\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)?\s+(road|rd|street|st|avenue|ave|lane|ln|drive|dr|way|court|ct|circle|place|boulevard|blvd)\b/i;
/** Interviewer housekeeping, not a question a viewer cares about. */
const INTERVIEWER_PROMPT = /\b(elaborat\w*|don'?t mind|in-depth|you don'?t have to|one word|that's totally okay|take your time)\b/i;
const DIGITS = /\d|\$|%/;
/** Spelled-out quantities; "one" is left out ("one day", "the one"). */
const NUMBER_WORDS = /\b(two|three|five|six|seven|eight|nine|ten|twenty|thirty|fifty|hundred|thousand|million|half)\b/i;
const CONTINUES = /^(and|but|so|because|cause|cuz|which|that|or)\b/i;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function sentences(words: TimedWord[], pause = 1.0): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const end =
      i === words.length - 1 ||
      /[.?!]["')\]]?$/.test(words[i]!.text.trim()) ||
      words[i + 1]!.start - words[i]!.end >= pause;
    if (end) {
      out.push({
        from,
        to: i,
        start: words[from]!.start,
        end: words[i]!.end,
        text: words.slice(from, i + 1).map((w) => w.text.trim()).join(' ')
      });
      from = i + 1;
    }
  }
  return out;
}

/** Opening-line score, with the reasons a reviewer will see. */
export function hookScore(line: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const words = line.split(/\s+/).filter(Boolean);
  const first = (words[0] ?? '').toLowerCase().replace(/[^a-z']/g, '');
  if (PRODUCTION_CHATTER.test(line)) { score -= 6; reasons.push('sounds like shoot chatter'); }
  if (ADDRESS.test(line)) { score -= 6; reasons.push('names a street address'); }
  if (INTERVIEWER_PROMPT.test(line)) { score -= 3; reasons.push('interviewer housekeeping'); }
  if (DIGITS.test(line)) { score += 3; reasons.push('specific number'); }
  else if (NUMBER_WORDS.test(line)) { score += 1; reasons.push('a quantity'); }
  if (CONTRADICTION.test(line)) { score += 2; reasons.push('contradiction'); }
  if (STAKES.test(line)) { score += 2; reasons.push('stakes'); }
  if (/\?\s*$/.test(line)) { score += 1.5; reasons.push('question'); }
  if (/\byou\b|\byour\b/i.test(line)) { score += 1; reasons.push('speaks to the viewer'); }
  if (words.length >= 4 && words.length <= 18) { score += 1; reasons.push('tight opening line'); }
  if (words.length > 25) { score -= 1.5; reasons.push('opening line runs long'); }
  if (words.length < 3) { score -= 2; reasons.push('opening line too short to hook'); }
  const weakPhrase = WEAK_OPENING_PHRASES.exec(line.trim());
  if (weakPhrase) { score -= 2; reasons.push(`starts on "${weakPhrase[1]!.toLowerCase()}"`); }
  else if (WEAK_OPENERS.has(first)) { score -= 2; reasons.push(`starts on "${first}"`); }
  if (/build ?x/i.test(line)) { score -= 1; reasons.push('BuildX in the hook (measured to lose)'); }
  return { score, reasons };
}

function titleFrom(hook: string): string {
  const clean = hook.replace(/[^\w\s$%'’,-]/g, '').trim();
  const words = clean.split(/\s+/).slice(0, 7).join(' ');
  return words.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/,$/, '');
}

export function findShortCandidates(words: TimedWord[], options: ShortOptions = {}): Omit<ShortCandidate, 'closeTo'>[] {
  const min = options.minSeconds ?? 30;
  const max = options.maxSeconds ?? 60;
  const limit = options.limit ?? 20;
  const sents = sentences(words, options.pauseSeconds ?? 1.0);

  const windows: Array<Omit<ShortCandidate, 'id' | 'closeTo' | 'approved'>> = [];
  for (let i = 0; i < sents.length; i++) {
    const open = sents[i]!;
    const hook = hookScore(open.text);
    let best: { j: number; score: number; reasons: string[] } | null = null;
    for (let j = i; j < sents.length; j++) {
      const dur = sents[j]!.end - open.start;
      if (dur > max) break;
      if (dur < min) continue;
      const reasons: string[] = [];
      let s = 0;
      const next = sents[j + 1];
      if (next && CONTINUES.test(next.text)) { s -= 1; reasons.push('thought continues past the end'); }
      if (/\?\s*$/.test(sents[j]!.text)) { s -= 1; reasons.push('ends on a question'); }
      if (dur >= 35 && dur <= 55) s += 0.5;
      if (!best || s > best.score) best = { j, score: s, reasons };
    }
    if (!best) continue;
    const last = sents[best.j]!;
    const span = words.slice(open.from, last.to + 1);
    const seconds = last.end - open.start;
    const density = span.length / seconds;
    const reasons = [...hook.reasons, ...best.reasons];
    let score = hook.score * 2 + best.score;
    if (density < 1.6) { score -= 1; reasons.push('sparse speech'); }
    windows.push({
      start: round(open.start),
      end: round(last.end),
      seconds: round(seconds),
      hook: open.text,
      title: titleFrom(open.text),
      score: round(score),
      reasons,
      text: span.map((w) => w.text.trim()).join(' ')
    });
  }

  // Best first, no overlaps.
  windows.sort((a, b) => b.score - a.score || a.start - b.start);
  const picked: typeof windows = [];
  for (const w of windows) {
    if (picked.length >= limit) break;
    if (picked.every((p) => w.end <= p.start || w.start >= p.end)) picked.push(w);
  }
  return picked.map((w, n) => ({ ...w, id: n + 1, approved: false }));
}

function tc(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function shortsMarkdown(name: string, list: ShortCandidate[]): string {
  const lines = [
    `> Short candidates for ${name}: 30–60s native windows ranked on their opening line. Nothing is built until you choose ids.`,
    '',
    `# Short candidates — ${name}`,
    '',
    `${list.length} candidates, best first. Build chosen ids with build_short_sequences. Built shorts still need captions, the first-frame thumbnail card and reframing per speaker.`,
    ''
  ];
  for (const c of list) {
    lines.push(
      `## ${c.id}. ${c.title} — ${tc(c.start)}–${tc(c.end)} (${c.seconds.toFixed(1)}s, score ${c.score})`,
      '',
      `**Hook:** ${c.hook}`,
      '',
      `Why: ${c.reasons.join('; ') || '—'}${c.closeTo ? `\n\n⚠ Close to a past hook: "${c.closeTo}"` : ''}`,
      '',
      `<details><summary>Full text</summary>\n\n${c.text}\n\n</details>`,
      ''
    );
  }
  return lines.join('\n');
}
