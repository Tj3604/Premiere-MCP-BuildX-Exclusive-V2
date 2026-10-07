/**
 * Music-bed ducking from WhisperX speech: the bed sits at bedDb in gaps and drops
 * to duckDb while anyone talks, with a short fade down before speech and a longer
 * fade back up after it.
 *
 * Optional pass, and not for shorts — BuildX shorts carry no music
 * (feedback: no music on shorts). Times are sequence seconds (a transcript of the
 * sequence's dialogue); apply_ducking converts them to the music clip's own time.
 */

import type { TimedWord } from '../edit/cleanup.js';

export interface Span {
  start: number;
  end: number;
}

export interface DuckOptions {
  bedDb?: number;
  duckDb?: number;
  /** Fade down this long before speech starts. */
  attackSeconds?: number;
  /** Fade back up over this long after speech ends. */
  releaseSeconds?: number;
  /** Gaps shorter than this stay ducked — no pumping between sentences. */
  mergeGapSeconds?: number;
}

export interface DuckKey {
  time: number;
  db: number;
}

export const DUCK_DEFAULTS: Required<DuckOptions> = {
  bedDb: -18,
  duckDb: -30,
  attackSeconds: 0.15,
  releaseSeconds: 0.4,
  mergeGapSeconds: 0.8
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Speech stretches: words joined across gaps shorter than mergeGap. */
export function speechSpans(words: TimedWord[], mergeGap = DUCK_DEFAULTS.mergeGapSeconds): Span[] {
  const spans: Span[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = spans[spans.length - 1];
    if (last && w.start - last.end < mergeGap) last.end = Math.max(last.end, w.end);
    else spans.push({ start: w.start, end: w.end });
  }
  return spans;
}

/**
 * Volume keyframes for the bed. Spans whose fades would overlap are merged first,
 * so the curve never dips back up for a moment between two close sentences.
 */
export function duckKeys(spans: Span[], options: DuckOptions = {}): DuckKey[] {
  const o = { ...DUCK_DEFAULTS, ...options };
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start - o.attackSeconds <= last.end + o.releaseSeconds) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  const keys: DuckKey[] = [];
  for (const s of merged) {
    const down = Math.max(0, s.start - o.attackSeconds);
    if (down > 0) keys.push({ time: round(down), db: o.bedDb });
    keys.push({ time: round(Math.max(down, s.start)), db: o.duckDb });
    keys.push({ time: round(s.end), db: o.duckDb });
    keys.push({ time: round(s.end + o.releaseSeconds), db: o.bedDb });
  }
  // A span at time 0 starts ducked: no bed key before it.
  return keys.filter((k, i) => i === 0 || k.time > keys[i - 1]!.time);
}

/**
 * Premiere's scripted Volume > Level is normalised with +15 dB as 1.0, so unity
 * (0 dB) is 0.17783, not 1.0 (reference_premiere_audio_level_scale).
 */
export function dbToPremiereLevel(db: number): number {
  return Math.pow(10, (db - 15) / 20);
}

export function premiereLevelToDb(level: number): number {
  return 20 * Math.log10(level) + 15;
}

/** Sequence-time keys -> the clip's media time, kept to the clip, with edge keys. */
export function keysForClip(keys: DuckKey[], clip: { start: number; end: number; inPoint: number }, bedDb: number): DuckKey[] {
  const at = (t: number): number => {
    // The curve's value at sequence time t (linear between keys, bed outside them).
    if (!keys.length || t <= keys[0]!.time) return keys.length && keys[0]!.time === 0 ? keys[0]!.db : bedDb;
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1]!, b = keys[i]!;
      if (t <= b.time) return a.db + ((b.db - a.db) * (t - a.time)) / (b.time - a.time);
    }
    return keys[keys.length - 1]!.db;
  };
  const toMedia = (t: number) => round(t - clip.start + clip.inPoint);
  const inside = keys.filter((k) => k.time > clip.start && k.time < clip.end).map((k) => ({ time: toMedia(k.time), db: k.db }));
  return [{ time: toMedia(clip.start), db: round(at(clip.start)) }, ...inside, { time: toMedia(clip.end), db: round(at(clip.end)) }];
}

function tc(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')}`;
}

export function duckingMarkdown(name: string, spans: Span[], keys: DuckKey[], o: Required<DuckOptions>): string {
  const ducked = keys.reduce((acc, k, i) => (i > 0 && keys[i - 1]!.db === o.duckDb && k.db === o.duckDb ? acc + (k.time - keys[i - 1]!.time) : acc), 0);
  const lines = [
    `> Ducking plan for ${name}: the music bed at ${o.bedDb} dB, down to ${o.duckDb} dB under speech. Nothing applied — use apply_ducking on the music clip.`,
    '',
    `# Ducking — ${name}`,
    '',
    `${spans.length} speech stretches, music ducked for ${ducked.toFixed(1)}s in total. Fade down ${o.attackSeconds}s before speech, back up over ${o.releaseSeconds}s after; gaps under ${o.mergeGapSeconds}s stay ducked.`,
    '',
    '| Ducked from | to | Length |',
    '|---|---|---|'
  ];
  for (let i = 1; i < keys.length; i++) {
    if (keys[i - 1]!.db === o.duckDb && keys[i]!.db === o.duckDb) {
      lines.push(`| ${tc(keys[i - 1]!.time)} | ${tc(keys[i]!.time)} | ${(keys[i]!.time - keys[i - 1]!.time).toFixed(1)}s |`);
    }
  }
  return lines.join('\n') + '\n';
}
