/**
 * Podcast-to-shorts: sentence windows, hook scoring, the candidate list, and the
 * build tool's guards against a fake bridge.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TimedWord } from '../../edit/cleanup.js';
import { createShortList } from '../../edit/files.js';
import { findShortCandidates, hookScore, sentences } from '../../edit/shorts.js';
import { executeEditTool } from '../../edit/tools.js';

/** Lays sentences out back to back, ~2.5 words/second. */
function speak(lines: Array<[number, string]>): TimedWord[] {
  const out: TimedWord[] = [];
  for (const [at, line] of lines) {
    const words = line.split(' ');
    words.forEach((text, k) => out.push({ text, start: at + k * 0.4, end: at + k * 0.4 + 0.35 }));
  }
  return out;
}

describe('sentences', () => {
  it('splits on end punctuation and on long pauses', () => {
    const s = sentences(speak([[0, 'One two three.'], [2, 'Four five'], [5, 'six seven.']]), 1.0);
    expect(s.map((x) => x.text)).toEqual(['One two three.', 'Four five', 'six seven.']);
  });
});

describe('hookScore', () => {
  it('rewards numbers, contradiction, stakes and questions', () => {
    const strong = hookScore('Most people never check the septic, and it cost them $40,000.');
    expect(strong.reasons).toEqual(expect.arrayContaining(['specific number', 'contradiction', 'stakes']));
    expect(hookScore('Why would you build in the flood zone?').reasons).toContain('question');
  });

  it('marks weak openers, BuildX in the hook, chatter and addresses down', () => {
    expect(hookScore('So, yeah, we started the project.').score).toBeLessThan(hookScore('We started the project.').score);
    expect(hookScore('I mean, the kitchen is great.').reasons).toContain('starts on "i mean"');
    expect(hookScore('BuildX builds great homes.').reasons).toContain('BuildX in the hook (measured to lose)');
    expect(hookScore("You're on camera four.").score).toBeLessThan(0);
    expect(hookScore('I live at 12 Sample Road in Springfield.').reasons).toContain('names a street address');
  });

  it('does not count "one" as a specific number', () => {
    expect(hookScore('There was not one day without work.').reasons).not.toContain('specific number');
  });
});

// 0-12s weak opener; 12s strong hook; each sentence ~4-5s.
const EPISODE = speak([
  [0, 'So we started talking about the whole thing.'],
  [5, 'And it was a long process for us.'],
  [12, 'Most people never check the septic before they buy.'],
  [18, 'It cost one family $40,000 to fix it.'],
  [24, 'The town would not issue the permit.'],
  [30, 'So they had to dig a whole new system.'],
  [36, 'That is why we test the soil first.'],
  [42, 'And then the framing went up fast.'],
  [48, 'Then we did the kitchen.'],
  [54, 'Everything came together.']
]);

describe('findShortCandidates', () => {
  const list = findShortCandidates(EPISODE, { minSeconds: 15, maxSeconds: 30, limit: 5 });

  it('ranks a strong opening line first, within the length limits', () => {
    expect(['Most people never check the septic before they buy.', 'It cost one family $40,000 to fix it.']).toContain(list[0]!.hook);
    expect(list.findIndex((c) => c.hook.startsWith('So we started'))).not.toBe(0);
    for (const c of list) {
      expect(c.seconds).toBeGreaterThanOrEqual(15);
      expect(c.seconds).toBeLessThanOrEqual(30);
    }
  });

  it('never overlaps and starts every candidate unapproved', () => {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k]!.start).toBeGreaterThanOrEqual(sorted[k - 1]!.end);
    expect(list.every((c) => c.approved === false)).toBe(true);
    expect(list.map((c) => c.id)).toEqual(list.map((_, i) => i + 1));
  });

  it('ends on a whole sentence', () => {
    for (const c of list) expect(c.text.trim()).toMatch(/[.?!]$/);
  });
});

describe('short tools', () => {
  async function setup() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bx-shorts-'));
    const transcript = path.join(dir, 'ep.words.json');
    await writeFile(transcript, JSON.stringify(EPISODE));
    return { dir, transcript };
  }

  it('find writes the review files and keeps an existing list', async () => {
    const { transcript, dir } = await setup();
    const first = await executeEditTool('find_short_candidates', { transcriptPath: transcript, minSeconds: 15, maxSeconds: 30 });
    expect(first).toMatchObject({ success: true, written: true });
    expect(await readFile(path.join(dir, 'ep.shorts.md'), 'utf8')).toMatch(/^> Short candidates/);
    expect((await executeEditTool('find_short_candidates', { transcriptPath: transcript })).written).toBe(false);
  });

  it('build refuses without a bridge, unknown ids, and a transcript longer than the master', async () => {
    const { transcript } = await setup();
    const { jsonPath } = await createShortList(transcript, { minSeconds: 15, maxSeconds: 30 });
    expect((await executeEditTool('build_short_sequences', { shortsPath: jsonPath, masterSequenceId: 'm', ids: [1] })).error).toMatch(/bridge/);
    const shortMaster = jest.fn().mockResolvedValue(
      JSON.stringify({ success: true, name: 'Ep', seconds: 20, width: 1920, height: 1080, videoTracks: 3, logos: [], cards: [] })
    );
    expect((await executeEditTool('build_short_sequences', { shortsPath: jsonPath, masterSequenceId: 'm', ids: [99] }, shortMaster)).error).toMatch(/No candidate id 99/);
    expect((await executeEditTool('build_short_sequences', { shortsPath: jsonPath, masterSequenceId: 'm', ids: [1] }, shortMaster)).error).toMatch(/not this sequence's transcript/);
  });

  it('build scales by the master height, places a video logo only, and warns on a still', async () => {
    const { transcript } = await setup();
    const { jsonPath } = await createShortList(transcript, { minSeconds: 15, maxSeconds: 30 });
    const scripts: string[] = [];
    const bridge = jest.fn(async (script: string) => {
      scripts.push(script);
      if (scripts.length === 1) {
        return JSON.stringify({
          success: true, name: 'Ep', seconds: 70, width: 1920, height: 1080, videoTracks: 3,
          logos: [{ id: 'L1', name: 'BuildX Logo WHITE.PNG.png', path: '/x/logo.png' }],
          cards: [{ id: 'C1', name: 'buildx-cta-adu-journey-9x16-ig-v3.mov', path: '/x/card.mov' }]
        });
      }
      return JSON.stringify({ success: true, sequenceId: 's', name: 'n', width: 1080, height: 1920, frameTicks: '8475667200', contentSeconds: 20, totalSeconds: 28, clipsScaled: 2, logo: null, endCard: { start: 20, end: 28 }, tail: { removed: 0, trimmed: 0, left: [] } });
    });
    const result = await executeEditTool('build_short_sequences', { shortsPath: jsonPath, masterSequenceId: 'm', ids: [1], prefix: 'EP12' }, bridge);
    expect(result.success).toBe(true);
    expect(scripts[1]).toContain('1920 / 1080');
    expect(scripts[1]).toContain('"EP12 ');
    expect(scripts[1]).not.toContain('"L1"'); // the still logo is never placed
    expect(scripts[1]).toContain('"C1"');
    expect(result.warnings.join(' ')).toMatch(/still logo/);
  });
});
