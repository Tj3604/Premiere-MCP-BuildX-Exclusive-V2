/**
 * Library search: transcript text extraction for every delivered format, and
 * TF-IDF ranking of past videos against a new transcript or topic.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { entriesDir, type VideoEntry } from '../../library/index.js';
import { findSimilarVideos, rankSimilar, tokenize } from '../../library/search.js';
import { firstSentence, textFromJson, textFromLines } from '../../library/transcript.js';

describe('transcript text extraction', () => {
  it('reads WhisperX words arrays, {words} and {text} JSON', () => {
    expect(textFromJson(JSON.stringify([{ text: 'Septic', start: 0, end: 1 }, { text: 'first.', start: 1, end: 2 }]))).toBe(
      'Septic first.'
    );
    expect(textFromJson(JSON.stringify({ words: [{ word: ' Be', start: 0, end: 1 }, { word: ' wary.', start: 1, end: 2 }] }))).toBe(
      'Be wary.'
    );
    expect(textFromJson(JSON.stringify({ text: 'Full of baloney.', segments: [] }))).toBe('Full of baloney.');
  });

  it('strips SRT indexes and timecodes', () => {
    const srt = '1\n00:00:00,000 --> 00:00:04,400\nAny contractor is full of baloney.\n\n2\n00:00:04,600 --> 00:00:04,920\nOkay.\n';
    expect(textFromLines(srt)).toBe('Any contractor is full of baloney. Okay.');
  });

  it('drops speaker labels in Premiere text exports, including DaVinci semicolon timecodes', () => {
    const premiere = '00:00:02:00 - 00:00:22:04\nHost\nWhat goes into that decision?\n\n00;00;22;06 - 00;00;35;08\nGUEST\nCan you take on the burden?\n';
    expect(textFromLines(premiere)).toBe('What goes into that decision? Can you take on the burden?');
  });

  it('strips bracketed timecodes and the generated timecoded header', () => {
    const timecoded = 'R12_Garages\nTimecoded transcript\n=====\n\n[00:00:00 - 00:00:01]  Garages are exempt.\n[00:00:02] From the GFA.\n';
    expect(textFromLines(timecoded)).toBe('Garages are exempt. From the GFA.');
  });

  it('takes the first sentence as the hook line', () => {
    expect(firstSentence('This is my last home. It is perfect.')).toBe('This is my last home.');
    expect(firstSentence('No terminal punctuation here')).toBe('No terminal punctuation here');
  });
});

function entry(slug: string, title: string, hookLine: string, transcriptPath: string): VideoEntry {
  return {
    schemaVersion: 1,
    slug,
    title,
    hookLine,
    transcriptPath,
    lengthSeconds: 30,
    cutCount: null,
    graphicsUsed: [],
    captionStyle: null,
    platformLinks: {},
    publishDate: null,
    performance: {
      views7d: null,
      views30d: null,
      avgViewDurationSeconds: null,
      retentionPercent: null,
      stayedToWatchPercent: null,
      measuredAt: null
    },
    exportPath: `/exports/${slug}.mp4`,
    addedAt: '2026-10-06T00:00:00Z'
  };
}

describe('rankSimilar', () => {
  const docs = [
    {
      entry: entry('septic', 'Septic Decides Everything', 'The septic decides everything.', '/t/septic.txt'),
      text: 'Before you design anything, the septic system and the water table decide where the ADU goes. Perc test first.'
    },
    {
      entry: entry('garage', 'Garages Are Exempt', 'Garages are exempt from the GFA.', '/t/garage.txt'),
      text: 'Garages are exempt from the GFA. Farmers porches are exempt. Basements under six seven are exempt.'
    },
    {
      entry: entry('kitchen', 'An Island For Seven', 'This island seats seven.', '/t/kitchen.txt'),
      text: 'The kitchen island seats seven people, quartz counters, soft close drawers.'
    }
  ];

  it('drops filler and function words', () => {
    expect(tokenize('Um, you know, the septic is like really important')).toEqual(['septic', 'important']);
  });

  it('ranks the topical match first and explains it with shared terms', () => {
    const results = rankSimilar('How the water table and septic decide placement', docs, 5);
    expect(results[0]!.slug).toBe('septic');
    expect(results[0]!.sharedTerms).toEqual(expect.arrayContaining(['septic', 'water', 'table']));
    expect(results.find((r) => r.slug === 'kitchen')).toBeUndefined();
  });

  it('respects the limit and excludes the query video itself', () => {
    expect(rankSimilar('exempt garages porches septic', docs, 1)).toHaveLength(1);
    const results = rankSimilar('Garages are exempt from the GFA', docs, 5, ['/exports/garage.mp4']);
    expect(results.map((r) => r.slug)).not.toContain('garage');
  });

  it('returns nothing for a query made only of stopwords', () => {
    expect(rankSimilar('um you know like really', docs, 5)).toEqual([]);
  });
});

describe('findSimilarVideos', () => {
  let privateDir: string;

  beforeEach(async () => {
    privateDir = await mkdtemp(path.join(tmpdir(), 'buildx-search-'));
    await mkdir(entriesDir(privateDir), { recursive: true });
  });

  afterEach(async () => {
    await rm(privateDir, { recursive: true, force: true });
  });

  it('reads each entry transcript from disk and reports unreadable ones', async () => {
    const srt = path.join(privateDir, 'septic.srt');
    await writeFile(srt, '1\n00:00:00,000 --> 00:00:03,000\nThe septic and water table decide everything.\n');
    const good = entry('septic', 'Septic', 'The septic decides.', srt);
    const missing = entry('lost', 'Lost', 'Gone.', path.join(privateDir, 'missing.txt'));
    await writeFile(path.join(entriesDir(privateDir), 'septic.json'), JSON.stringify(good));
    await writeFile(path.join(entriesDir(privateDir), 'lost.json'), JSON.stringify(missing));

    const result = await findSimilarVideos(privateDir, 'water table septic', 5);
    expect(result.librarySize).toBe(2);
    expect(result.results[0]!.slug).toBe('septic');
    expect(result.transcriptProblems).toHaveLength(1);
    expect(result.transcriptProblems[0]).toMatch(/^lost:/);
  });
});
