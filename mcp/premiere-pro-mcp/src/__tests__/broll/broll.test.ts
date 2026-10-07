/**
 * B-roll tagging from library paths and transcript matching.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TimedWord } from '../../edit/cleanup.js';
import { executeEditTool } from '../../edit/tools.js';
import { buildClip, flagsFor, orientationFromName, pathTokens, tagsForPath } from '../../broll/index.js';
import { phraseConcepts, suggestBroll } from '../../broll/match.js';

describe('tags from paths', () => {
  it('splits folders, underscores and camel case, and drops job codes and numbers', () => {
    const t = pathTokens('ADU/WIP (Under Construction)/ADU_Interior_JobA_KitchenRough_01.mp4');
    expect(t).toEqual(expect.arrayContaining(['adu', 'wip', 'construction', 'interior', 'kitchen', 'rough']));
    expect(pathTokens('ADU/FINISHED/X1251_INTERIOR_33.mp4')).toEqual(['adu', 'finished', 'interior']);
    expect(pathTokens('DRONE/FINISHED/A1103_DRONE_12.mp4')).toEqual(['drone', 'finished']);
  });

  it('adds the concepts the words mean', () => {
    expect(tagsForPath('ELECTRICAL/ELECTRICAL_RoughIn_Interior_MiniSplit_03.mp4')).toEqual(expect.arrayContaining(['electrical', 'hvac']));
    expect(tagsForPath('FRAMING/FRAMING_Interior_StudWalls_ShowerUnit_04.mp4')).toEqual(expect.arrayContaining(['framing', 'bathroom']));
    expect(tagsForPath('DRONE/WIP (Under Construction)/DRONE_2025_01.mp4')).toEqual(expect.arrayContaining(['aerial', 'construction']));
  });

  it('flags the Bedrock watermark, third-party logos and finished edits', () => {
    expect(flagsFor('TIMELAPSE/X1237_TIMELAPSE_01.mp4')[0]).toMatch(/bedrock/);
    expect(flagsFor('SITEWORK/SITEWORK_Equipment_X_CatExcavator_Logo_01.mp4')[0]).toMatch(/third-party/);
    expect(flagsFor('CUSTOMERS/HOMETOUR EDITS/Floor_Plans.mp4')[0]).toMatch(/finished edit/);
    expect(flagsFor('FRAMING/FRAMING_Interior_Trusses_Ceiling_01.mp4')).toEqual([]);
  });

  it('knows orientation from the name only where it was measured', () => {
    expect(orientationFromName('ADU/FINISHED/X1251_INTERIOR_44.mp4')).toBe('vertical');
    expect(orientationFromName('ADU/FINISHED/X1251_INTERIOR_45.mp4')).toBe('horizontal');
    expect(orientationFromName('FRAMING/FRAMING_Crew_X_Nailer_TopDown_Vertical_01.mp4')).toBe('vertical');
    expect(orientationFromName('ADU/FINISHED/817_EXTERIOR_01.mp4')).toBeNull();
  });

  it('keeps visual tags and a probed orientation across rebuilds', () => {
    const prev = { ...buildClip('ADU/FINISHED/817_INTERIOR_01.mp4'), visualTags: ['kitchen'], orientation: 'horizontal' as const };
    const next = buildClip('ADU/FINISHED/817_INTERIOR_01.mp4', prev);
    expect(next.visualTags).toEqual(['kitchen']);
    expect(next.orientation).toBe('horizontal');
  });
});

describe('phraseConcepts', () => {
  it('reads concepts and two-word phrases, ignoring everyday BuildX words', () => {
    expect(phraseConcepts('We put in a heat pump and new cabinets.')).toEqual(expect.arrayContaining(['hvac', 'kitchen']));
    expect(phraseConcepts('We build ADUs at BuildX.')).toEqual([]);
    expect(phraseConcepts('a lot of planning')).toEqual([]);
  });
});

const w = (text: string, start: number, end: number): TimedWord => ({ text, start, end });
const WORDS: TimedWord[] = [
  w('This', 0, 0.3), w('kitchen', 0.35, 0.8), w('sold', 0.85, 1.1), w('us.', 1.15, 1.5),
  w('The', 3, 3.2), w('excavator', 3.25, 3.9), w('dug', 3.95, 4.2), w('the', 4.25, 4.35), w('foundation.', 4.4, 5.1),
  w('Then', 6, 6.2), w('framing', 6.25, 6.8), w('went', 6.85, 7.0), w('up', 7.05, 7.2), w('fast.', 7.25, 7.8),
  w('And', 12, 12.2), w('the', 12.25, 12.35), w('kitchen', 12.4, 12.9), w('cabinets', 12.95, 13.5), w('arrived.', 13.55, 14.2)
];
const CLIPS = [
  buildClip('ADU/WIP (Under Construction)/ADU_Interior_JobA_KitchenRough_01.mp4'),
  buildClip('ADU/FINISHED/817_INTERIOR_02.mp4'),
  { ...buildClip('ADU/FINISHED/817_INTERIOR_03.mp4'), visualTags: ['kitchen', 'cabinets'] },
  buildClip('DRONE/WIP (Under Construction)/DRONE_SiteWork_JobB_ExcavatorDig_28.mp4'),
  buildClip('DRONE/WIP (Under Construction)/DRONE_SiteWork_JobC_FoundationExcavators_19.mp4'),
  buildClip('FRAMING/FRAMING_Interior_StudWalls_Walkthrough_02.mp4'),
  { ...buildClip('FRAMING/FRAMING_Crew_X_Nailer_TopDown_Vertical_01.mp4') },
  buildClip('TIMELAPSE/X1237_TIMELAPSE_01.mp4')
];

describe('suggestBroll', () => {
  it('never covers the hook and keeps cutaways apart', () => {
    const list = suggestBroll(WORDS, CLIPS, { minGapSeconds: 5 });
    expect(list.every((s) => s.start >= 1.5)).toBe(true);
    for (let k = 1; k < list.length; k++) expect(list[k]!.start - list[k - 1]!.start).toBeGreaterThanOrEqual(5);
    expect(list.every((s) => s.approved === false)).toBe(true);
  });

  it('puts the clip named for the exact word first', () => {
    const list = suggestBroll(WORDS, CLIPS, { minGapSeconds: 1 });
    const dig = list.find((s) => s.phrase.includes('excavator'))!;
    expect(dig.clips[0]!.path).toMatch(/Excavator/);
  });

  it('leaves out flagged clips, and vertical clips for 16x9', () => {
    const all = suggestBroll(WORDS, CLIPS, { minGapSeconds: 1, format: '16x9', clipsPerSuggestion: 10 }).flatMap((s) => s.clips.map((c) => c.path));
    expect(all.some((p) => /TIMELAPSE/.test(p))).toBe(false);
    expect(all.some((p) => /Vertical/.test(p))).toBe(false);
  });

  it('uses visual tags and prefers the named job', () => {
    const list = suggestBroll(WORDS, CLIPS, { minGapSeconds: 1, prefer: '817' });
    const kitchen = list.find((s) => s.phrase.includes('cabinets'))!;
    expect(kitchen.clips[0]!.path).toBe('ADU/FINISHED/817_INTERIOR_03.mp4');
    // A folder-only clip ("interior") never qualifies on its own.
    expect(list.flatMap((s) => s.clips.map((c) => c.path))).not.toContain('ADU/FINISHED/817_INTERIOR_02.mp4');
  });
});

describe('suggest_broll tool', () => {
  it('reads the private index and writes the review files', async () => {
    const privateDir = await mkdtemp(path.join(os.tmpdir(), 'bx-broll-'));
    await mkdir(path.join(privateDir, 'broll'));
    await writeFile(path.join(privateDir, 'broll', 'index.json'), JSON.stringify({ description: 't', root: '/lib', builtAt: 'x', clips: CLIPS }));
    const transcript = path.join(privateDir, 'clip.words.json');
    await writeFile(transcript, JSON.stringify(WORDS));
    const result = await executeEditTool('suggest_broll', { transcriptPath: transcript }, undefined, { privateDir });
    expect(result).toMatchObject({ success: true, libraryClips: CLIPS.length, written: true });
    expect(result.count).toBeGreaterThan(0);
    expect(await readFile(path.join(privateDir, 'clip.broll.md'), 'utf8')).toMatch(/^> B-roll suggestions/);
    expect((await executeEditTool('suggest_broll', { transcriptPath: transcript }, undefined, {})).error).toMatch(/BUILDX_PRIVATE_DIR/);
    const missing = await executeEditTool('suggest_broll', { transcriptPath: transcript }, undefined, { privateDir: os.tmpdir() + '/nope-' + Date.now() });
    expect(missing.error).toMatch(/broll-tag\.mjs/);
  });
});
