/**
 * Transcript -> b-roll suggestions. Optional pass: every suggestion starts
 * unapproved, and per broll.md the first question is whether to cut away at all,
 * so this only offers coverage for phrases that name something showable.
 */

import type { TimedWord } from '../edit/cleanup.js';
import { BrollClip, conceptsFor } from './index.js';

export interface BrollCandidate {
  path: string;
  score: number;
  matched: string[];
  flags: string[];
  orientation: BrollClip['orientation'];
}

export interface BrollSuggestion {
  id: number;
  start: number;
  end: number;
  phrase: string;
  concepts: string[];
  clips: BrollCandidate[];
  approved: boolean;
}

export interface BrollOptions {
  /** Target sequence shape. A vertical clip cannot cover a 16:9 sequence. */
  format?: '9x16' | '16x9';
  /** Seconds between cutaways, at least. */
  minGapSeconds?: number;
  /** No coverage before this — the hook stays on the speaker. Default: end of the first sentence. */
  hookSeconds?: number;
  clipsPerSuggestion?: number;
  /** Include watermark / third-party-logo clips. Default false. */
  includeFlagged?: boolean;
  pauseSeconds?: number;
  /** Prefer this job's own footage: a job number or name found in the clip path, e.g. "817" or "X1252". */
  prefer?: string;
}

/** Score bonus for a clip from the preferred job. */
const PREFER_BONUS = 2;

/** Concepts too broad to justify a cutaway on their own; they only add to a specific match. */
const BROAD = new Set(['construction', 'interior', 'exterior', 'finished', 'crew', 'tour', 'customer', 'brand', 'owner']);
const BROAD_WEIGHT = 0.4;
/** A phrase needs at least this score, from at least one specific concept, to be offered. */
const MIN_SCORE = 2.5;
/** Shorter phrases are a word or two — nothing to cover. */
const MIN_PHRASE_SECONDS = 0.8;

/** Words said in nearly every BuildX video — they say nothing about what to show. */
const SPEECH_IGNORE = new Set(['build', 'building', 'buildx', 'design', 'site', 'walk', 'family', 'done', 'plan', 'service', 'room', 'inside', 'outside', 'wall']);

const PHRASES: Array<[RegExp, string]> = [
  [/\bheat pumps?\b/, 'hvac'], [/\bmini ?splits?\b/, 'hvac'], [/\bfloor ?plans?\b/, 'plans'], [/\bsite plans?\b/, 'plans'],
  [/\bopen house\b/, 'tour'], [/\bhome tours?\b/, 'tour'], [/\bwater table\b/, 'septic'], [/\bleach(ing)? fields?\b/, 'septic'],
  [/\bliving rooms?\b/, 'living'], [/\brough[- ]in\b/, 'electrical'], [/\bmove[d]? in\b/, 'finished'], [/\bsite ?work\b/, 'sitework'],
  [/\belectrical panel\b/, 'electrical'], [/\bfloor plan\b/, 'plans']
];

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9']/g, '');
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Sentences, split further at pauses, capped at ~12 words. */
export function phrases(words: TimedWord[], pause = 0.6, maxWords = 12): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const endHere =
      i === words.length - 1 ||
      /[.?!]["')\]]?$/.test(words[i]!.text.trim()) ||
      words[i + 1]!.start - words[i]!.end >= pause ||
      i - from + 1 >= maxWords;
    if (endHere) {
      out.push({ from, to: i });
      from = i + 1;
    }
  }
  return out;
}

function phraseWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(norm)
    .filter((w) => w.length >= 3 && !SPEECH_IGNORE.has(w));
}

export function phraseConcepts(text: string): string[] {
  const low = text.toLowerCase();
  const found = new Set<string>();
  for (const [re, concept] of PHRASES) if (re.test(low)) found.add(concept);
  for (const raw of low.split(/\s+/)) {
    const w = norm(raw);
    if (!w || SPEECH_IGNORE.has(w)) continue;
    for (const c of conceptsFor(w)) found.add(c);
    if (w.endsWith('s')) for (const c of conceptsFor(w.slice(0, -1))) found.add(c);
  }
  return [...found];
}

export function suggestBroll(words: TimedWord[], clips: BrollClip[], options: BrollOptions = {}): BrollSuggestion[] {
  const minGap = options.minGapSeconds ?? 5;
  const perSuggestion = options.clipsPerSuggestion ?? 3;
  const usable = clips.filter(
    (c) =>
      (options.includeFlagged || c.flags.length === 0) &&
      !(options.format === '16x9' && c.orientation === 'vertical')
  );
  if (words.length === 0 || usable.length === 0) return [];

  // Concept rarity across the library: "kitchen" should beat "interior".
  const df = new Map<string, number>();
  for (const c of usable) for (const t of new Set([...c.tags, ...c.visualTags])) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log((usable.length + 1) / ((df.get(t) ?? 0) + 1)) + 1;

  const prefer = options.prefer?.trim().toLowerCase();
  const preferred = (c: BrollClip) =>
    !!prefer && c.path.toLowerCase().split(/[\\/_\s\-.()#]+/).includes(prefer);

  const spans = phrases(words, options.pauseSeconds ?? 0.6);
  const hookEnd = options.hookSeconds ?? words[spans[0]!.to]!.end;

  type Scored = { span: { from: number; to: number }; concepts: string[]; ranked: BrollCandidate[]; best: number };
  const scored: Scored[] = [];
  for (const span of spans) {
    if (words[span.from]!.start < hookEnd) continue;
    if (words[span.to]!.end - words[span.from]!.start < MIN_PHRASE_SECONDS) continue;
    const text = words.slice(span.from, span.to + 1).map((w) => w.text).join(' ');
    const concepts = phraseConcepts(text);
    if (!concepts.some((k) => !BROAD.has(k))) continue;
    const said = phraseWords(text);
    const ranked = usable
      .map((c) => {
        const have = new Set([...c.tags, ...c.visualTags]);
        const matched = concepts.filter((k) => have.has(k));
        // The exact word in the clip name ("excavator") beats a concept-only match.
        const exact = said.filter((w) => have.has(w) && !matched.includes(w));
        if (!matched.some((k) => !BROAD.has(k))) return { path: c.path, score: 0, matched, flags: c.flags, orientation: c.orientation };
        const score =
          matched.reduce((a, k) => a + idf(k) * (BROAD.has(k) ? BROAD_WEIGHT : 1), 0) +
          exact.reduce((a, w) => a + idf(w) * 0.5, 0) +
          (c.visualTags.some((t) => concepts.includes(t)) ? 0.5 : 0) +
          (preferred(c) ? PREFER_BONUS : 0);
        return { path: c.path, score: round(score), matched: [...matched, ...exact], flags: c.flags, orientation: c.orientation };
      })
      .filter((r) => r.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    if (ranked.length) scored.push({ span, concepts, ranked, best: ranked[0]!.score });
  }

  // Strongest phrases first, kept minGap apart; each clip offered once where possible.
  scored.sort((a, b) => b.best - a.best || words[a.span.from]!.start - words[b.span.from]!.start);
  const picked: Scored[] = [];
  for (const s of scored) {
    const t = words[s.span.from]!.start;
    if (picked.every((p) => Math.abs(words[p.span.from]!.start - t) >= minGap)) picked.push(s);
  }
  picked.sort((a, b) => words[a.span.from]!.start - words[b.span.from]!.start);

  const used = new Set<string>();
  return picked.map((s, n) => {
    const fresh = s.ranked.filter((r) => !used.has(r.path));
    const choice = (fresh.length >= perSuggestion ? fresh : [...fresh, ...s.ranked.filter((r) => used.has(r.path))]).slice(0, perSuggestion);
    for (const c of choice) used.add(c.path);
    return {
      id: n + 1,
      start: round(words[s.span.from]!.start),
      end: round(words[s.span.to]!.end),
      phrase: words.slice(s.span.from, s.span.to + 1).map((w) => w.text).join(' '),
      concepts: s.concepts,
      clips: choice,
      approved: false
    };
  });
}

function tc(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')}`;
}

export function brollMarkdown(name: string, list: BrollSuggestion[]): string {
  const lines = [
    `> B-roll suggestions for ${name}: library clips whose tags match what is being said. Optional — nothing is approved or placed until you choose. Stay on the speaker when the delivery is the content (broll.md).`,
    '',
    `# B-roll — ${name}`,
    '',
    `${list.length} suggestions.`,
    ''
  ];
  for (const s of list) {
    lines.push(`## ${s.id}. ${tc(s.start)}–${tc(s.end)} — ${s.concepts.join(', ')}`, '', `> ${s.phrase}`, '');
    for (const c of s.clips) {
      const notes = [c.orientation ?? 'orientation unchecked', ...c.flags].join('; ');
      lines.push(`- \`${c.path}\` — matched ${c.matched.join(', ')} (score ${c.score}; ${notes})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
