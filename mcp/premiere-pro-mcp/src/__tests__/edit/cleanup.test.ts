/**
 * Silence/filler cut list: detection, keep-range math, and the files round trip.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findCuts, keepRanges, summarize, TimedWord, wordsFrom } from '../../edit/cleanup.js';
import { applyCutList, createCutList } from '../../edit/files.js';

const w = (text: string, start: number, end: number): TimedWord => ({ text, start, end });

// "So, um, the septic [1.2s pause] decides like everything you know."
const WORDS: TimedWord[] = [
  w('So,', 0.5, 0.7),
  w('um,', 0.9, 1.1),
  w('the', 1.3, 1.4),
  w('septic', 1.45, 1.9),
  w('decides', 3.1, 3.5),
  w('like', 3.55, 3.7),
  w('everything', 3.75, 4.3),
  w('you', 4.35, 4.5),
  w('know.', 4.5, 4.8)
];

describe('findCuts', () => {
  const cuts = findCuts(WORDS, { minPauseSeconds: 0.6, keepPauseSeconds: 0.1 });

  it('marks um as cut and eats the gaps either side, leaving a breath', () => {
    const um = cuts.find((c) => c.text === 'um,')!;
    expect(um).toMatchObject({ kind: 'filler', action: 'cut', approved: true });
    expect(um.start).toBeCloseTo(0.75); // So, ends 0.7 + half of 0.1
    expect(um.end).toBeCloseTo(1.25); // the starts 1.3 - 0.05
  });

  it('marks like and you know as review, not approved', () => {
    const review = cuts.filter((c) => c.action === 'review').map((c) => c.text);
    expect(review).toEqual(['like', 'you know.']);
    expect(cuts.filter((c) => c.action === 'review').every((c) => !c.approved)).toBe(true);
  });

  it('cuts a long pause down to the breath and ignores short gaps', () => {
    const pauses = cuts.filter((c) => c.kind === 'pause');
    expect(pauses).toHaveLength(1);
    expect(pauses[0]!.start).toBeCloseTo(1.95);
    expect(pauses[0]!.end).toBeCloseTo(3.05);
    expect(pauses[0]!.before).toMatch(/septic$/);
    expect(pauses[0]!.after).toMatch(/^decides/);
  });

  it('cuts dead air before the first word and after the last when the length is known', () => {
    const words = [w('Hello', 1.0, 1.4), w('there.', 1.5, 1.9)];
    const edge = findCuts(words, { minPauseSeconds: 0.6, keepPauseSeconds: 0.1, durationSeconds: 3.5 });
    expect(edge.map((c) => [c.start, c.end])).toEqual([
      [0, 0.95],
      [1.95, 3.5]
    ]);
  });

  it('numbers suggestions in time order', () => {
    expect(cuts.map((c) => c.id)).toEqual(cuts.map((_, i) => i + 1));
    expect([...cuts].sort((a, b) => a.start - b.start)).toEqual(cuts);
  });
});

describe('keepRanges', () => {
  it('is the source minus approved cuts only', () => {
    const cuts = findCuts(WORDS, { minPauseSeconds: 0.6, keepPauseSeconds: 0.1 });
    const keeps = keepRanges(cuts, 4.8);
    expect(keeps).toEqual([
      { start: 0, end: 0.75 },
      { start: 1.25, end: 1.95 },
      { start: 3.05, end: 4.8 }
    ]);
    const removed = 4.8 - keeps.reduce((a, k) => a + (k.end - k.start), 0);
    const approved = summarize(cuts.filter((c) => c.approved), 4.8).cutSeconds;
    expect(removed).toBeCloseTo(approved);
    // No keep overlaps an approved cut.
    for (const c of cuts.filter((x) => x.approved)) {
      for (const k of keeps) expect(k.end <= c.start + 1e-9 || k.start >= c.end - 1e-9).toBe(true);
    }
  });
});

describe('wordsFrom', () => {
  it('accepts a WhisperX array or {words}', () => {
    expect(wordsFrom([{ text: 'a', start: 0, end: 1 }])).toHaveLength(1);
    expect(wordsFrom({ words: [{ word: 'b', start: 0, end: 1 }] })[0]!.text).toBe('b');
    expect(() => wordsFrom({ nope: 1 })).toThrow(/words/);
  });
});

describe('cut list files', () => {
  it('writes, refuses to overwrite approvals, and applies overrides', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bx-cuts-'));
    const transcript = path.join(dir, 'clip.words.json');
    await writeFile(transcript, JSON.stringify(WORDS));

    const first = await createCutList(transcript, { minPauseSeconds: 0.6, keepPauseSeconds: 0.1 });
    expect(first.written).toBe(true);
    expect(first.cutsJson).toBe(path.join(dir, 'clip.cuts.json'));
    expect(await readFile(first.cutsMd, 'utf8')).toMatch(/^> Cut list for clip/);

    const second = await createCutList(transcript);
    expect(second.written).toBe(false);

    const likeId = first.list.cuts.find((c) => c.text === 'like')!.id;
    const umId = first.list.cuts.find((c) => c.text === 'um,')!.id;
    const applied = await applyCutList(first.cutsJson, { approve: [likeId], reject: [umId] });
    expect(applied.approved).toContain(likeId);
    expect(applied.approved).not.toContain(umId);
    expect(JSON.parse(await readFile(applied.keepsPath, 'utf8'))).toEqual(applied.keeps);
    await expect(applyCutList(first.cutsJson, { approve: [999] })).rejects.toThrow(/No cut #999/);
  });
});
