/**
 * Punch-in suggestions: triggers, spacing, keyframe math, and the apply tool
 * against a fake bridge.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TimedWord } from '../../edit/cleanup.js';
import { createPunchList } from '../../edit/files.js';
import { punchKeyframes, suggestPunchIns } from '../../edit/punchins.js';
import { executeEditTool } from '../../edit/tools.js';

const w = (text: string, start: number, end: number): TimedWord => ({ text, start, end });

// 0-2s: intro. 2.5: "never" (stakes). 3.2: "$40,000" (number, 0.7s later — too close).
// 9.0: sentence start after a pause.
const WORDS: TimedWord[] = [
  w('So', 0.1, 0.3),
  w('we', 0.35, 0.5),
  w('build', 0.55, 0.9),
  w('ADUs.', 0.95, 1.5),
  w('You', 2.0, 2.2),
  w('never', 2.5, 2.9),
  w('pay', 2.95, 3.1),
  w('$40,000', 3.2, 3.9),
  w('upfront.', 3.95, 4.6),
  w('And', 9.0, 9.2),
  w('the', 9.25, 9.35),
  w('permit', 9.4, 9.8),
  w('is', 9.85, 9.95),
  w('included.', 10.0, 10.7)
];

describe('suggestPunchIns', () => {
  const list = suggestPunchIns(WORDS, { minGapSeconds: 4, easeSeconds: 0.3 });

  it('prefers numbers over stakes words and keeps punch-ins apart', () => {
    expect(list.map((p) => p.word)).toEqual(['$40,000', 'And']);
    expect(list[0]!.reason).toMatch(/number/);
    expect(list[1]!.reason).toBe('sentence start');
    for (let k = 1; k < list.length; k++) expect(list[k]!.inAt - list[k - 1]!.inAt).toBeGreaterThanOrEqual(4);
  });

  it('eases in before the word, holds to the end of the phrase, eases out', () => {
    const p = list[0]!;
    expect(p.rampInStart).toBeCloseTo(2.9);
    expect(p.inAt).toBeCloseTo(3.2);
    expect(p.holdEnd).toBeCloseTo(4.6); // "upfront." ends the sentence
    expect(p.rampOutEnd).toBeCloseTo(4.9);
    expect(p.phrase).toBe('$40,000 upfront.');
  });

  it('starts every suggestion unapproved', () => {
    expect(list.every((p) => p.approved === false)).toBe(true);
    expect(list.map((p) => p.id)).toEqual([1, 2]);
  });

  it('never lets a hold run into the next ease', () => {
    const tight = suggestPunchIns(WORDS, { minGapSeconds: 0.5, easeSeconds: 0.3 });
    for (let k = 1; k < tight.length; k++) expect(tight[k - 1]!.rampOutEnd).toBeLessThanOrEqual(tight[k]!.rampInStart + 1e-9);
  });
});

describe('punchKeyframes', () => {
  it('is relative to the clip scale, not a flat 110', () => {
    const p = suggestPunchIns(WORDS)[0]!;
    expect(punchKeyframes(p, 56, 110).map((k) => k.value)).toEqual([56, 61.6, 61.6, 56]);
    expect(punchKeyframes(p, 100, 110).map((k) => k.time)).toEqual([p.rampInStart, p.inAt, p.holdEnd, p.rampOutEnd]);
  });
});

describe('punch-in tools', () => {
  async function setup() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bx-punch-'));
    const transcript = path.join(dir, 'clip.words.json');
    await writeFile(transcript, JSON.stringify(WORDS));
    return { dir, transcript };
  }

  it('suggest writes the review files and keeps an existing list', async () => {
    const { transcript, dir } = await setup();
    const first = await executeEditTool('suggest_punch_ins', { transcriptPath: transcript });
    expect(first).toMatchObject({ success: true, count: 2, written: true });
    expect(await readFile(path.join(dir, 'clip.punchins.md'), 'utf8')).toMatch(/^> Punch-in suggestions/);
    const again = await executeEditTool('suggest_punch_ins', { transcriptPath: transcript });
    expect(again.written).toBe(false);
  });

  it('apply refuses without a bridge, unknown ids, and keyframed clips', async () => {
    const { transcript } = await setup();
    const { jsonPath } = await createPunchList(transcript);
    expect((await executeEditTool('apply_punch_ins', { punchinsPath: jsonPath, clipId: 'c', ids: [1] })).error).toMatch(/bridge/);
    const bridge = jest.fn().mockResolvedValue(
      JSON.stringify({ success: true, base: 100, timeVarying: true, inPoint: 0, outPoint: 20, start: 0, name: 'clip' })
    );
    expect((await executeEditTool('apply_punch_ins', { punchinsPath: jsonPath, clipId: 'c', ids: [9] }, bridge)).error).toMatch(/No punch-in id 9/);
    expect((await executeEditTool('apply_punch_ins', { punchinsPath: jsonPath, clipId: 'c', ids: [1] }, bridge)).error).toMatch(/already has keyframes/);
  });

  it('apply sends only the chosen ids and skips ones outside the clip', async () => {
    const { transcript } = await setup();
    const { jsonPath } = await createPunchList(transcript);
    const scripts: string[] = [];
    const bridge = jest.fn(async (script: string) => {
      scripts.push(script);
      if (scripts.length === 1) return JSON.stringify({ success: true, base: 56, timeVarying: false, inPoint: 2, outPoint: 6, start: 0, name: 'clip' });
      return JSON.stringify({ success: true, keys: [], sample: 56.5 });
    });
    const result = await executeEditTool('apply_punch_ins', { punchinsPath: jsonPath, clipId: 'c', ids: [1, 2] }, bridge);
    expect(result.success).toBe(true);
    expect(result.applied).toEqual([1]);
    expect(result.skipped).toEqual([expect.objectContaining({ id: 2 })]);
    expect(result.keyframesExpected).toBe(4);
    expect(scripts[1]).toContain('61.6');
    expect(scripts[1]).toMatch(/setInterpolationTypeAtKey\(keys\[k\]\.time, 4[\s\S]*setInterpolationTypeAtKey\(keys\[k\]\.time, 5/);
    expect(result.easeCheck.eased).toBe(true); // 56.5 < linear 57.4
  });
});
