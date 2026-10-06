/**
 * Caption cues: measured-width fitting, sentence breaks, no overlaps, SRT output,
 * flags, and the two tools.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TimedWord } from '../../edit/cleanup.js';
import { balance, buildCues, flagCues, FRAME_2997, overlaps, parseLexicon, textWidth, toSrt } from '../../captions/build.js';
import { executeCaptionTool } from '../../captions/tools.js';

function speak(text: string, at = 0, step = 0.3): TimedWord[] {
  return text.split(' ').map((t, k) => ({ text: t, start: at + k * step, end: at + k * step + step * 0.8, score: 0.9 }));
}

describe('textWidth', () => {
  it('matches the widths measured in Chromium at Poppins Bold 75', () => {
    expect(Math.round(textWidth('newest ADU build in'))).toBe(760);
    expect(Math.round(textWidth('ground today on our'))).toBe(787);
  });
});

describe('buildCues', () => {
  const words = [
    ...speak('Well, the crew knows how much this whole build matters here.', 0.2),
    ...speak('The slab went in today.', 4),
    ...speak('Septic decides everything.', 8)
  ];
  const cues = buildCues(words);

  it('keeps every line under the width ceiling', () => {
    for (const c of cues) expect(c.widthPx).toBeLessThanOrEqual(745);
  });

  it('never runs a caption across a sentence end', () => {
    for (const c of cues) expect(c.text.slice(0, -1)).not.toMatch(/[.?!] \S/);
  });

  it('never overlaps and stays clear of frame 0', () => {
    expect(overlaps(cues)).toEqual([]);
    expect(cues[0]!.start).toBeGreaterThanOrEqual(FRAME_2997 - 1e-9);
  });

  it('stretches a short cue toward 1.2s only where the next cue leaves room', () => {
    const last = cues[cues.length - 1]!;
    expect(last.end - last.start).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });

  it('pulls a too-early first word off frame 0', () => {
    const early = buildCues(speak('Hello there.', 0));
    expect(early[0]!.start).toBeCloseTo(FRAME_2997, 3);
  });

  it('separates overlapping word timings into a strict sequence', () => {
    const messy: TimedWord[] = [
      { text: 'One.', start: 0.5, end: 1.4 },
      { text: 'Two.', start: 1.0, end: 1.6 },
      { text: 'Three.', start: 1.05, end: 2.0 }
    ];
    expect(overlaps(buildCues(messy))).toEqual([]);
  });
});

describe('balance', () => {
  it('splits a long sentence into even lines, not a full line and an orphan', () => {
    const seg = speak("And it's going to be perfect.");
    const lines = balance(seg, 745).map((l) => l.map((w) => w.text).join(' '));
    expect(lines.length).toBe(2);
    const widths = lines.map((l) => textWidth(l));
    expect(Math.min(...widths) / Math.max(...widths)).toBeGreaterThan(0.5);
  });
});

describe('toSrt', () => {
  it('writes SRT blocks with comma milliseconds', () => {
    expect(toSrt([{ index: 1, start: 61.5, end: 62.25, text: 'Hi.', widthPx: 1 }])).toBe('1\n00:01:01,500 --> 00:01:02,250\nHi.\n');
  });
});

describe('flags', () => {
  const lexicon = parseLexicon(
    ['## Transcription lexicon', '', '| Transcript produced | Actually | Context |', '|---|---|---|', '| "loom and seed" | **"loam and seed"** | Landscaping |', '', '## Naming rules'].join('\n')
  );

  it('reads the lexicon table', () => {
    expect(lexicon.phrases).toEqual([{ produced: 'loom and seed', note: '"loam and seed"' }]);
  });

  it('flags low confidence, lexicon hits, figures and drywall without changing text', () => {
    const words = [
      ...speak('We did loom and seed.', 0.5),
      { text: 'It', start: 3, end: 3.2, score: 0.9 },
      { text: 'cost', start: 3.3, end: 3.5, score: 0.3 },
      { text: '$40,000.', start: 3.6, end: 4.2, score: 0.9 },
      ...speak('No drywall here.', 6)
    ];
    const cues = buildCues(words);
    const flags = flagCues(cues, words, lexicon);
    const reasons = flags.map((f) => f.reason).join(' | ');
    expect(reasons).toMatch(/low confidence/);
    expect(reasons).toMatch(/known mis-transcription/);
    expect(reasons).toMatch(/verified-facts/);
    expect(reasons).toMatch(/thin coat plaster/);
    expect(cues.map((c) => c.text).join(' ')).toContain('loom and seed');
  });
});

describe('caption tools', () => {
  it('make_captions writes the SRT and review sheet, re-timed for a range', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bx-cap-'));
    await mkdir(path.join(dir, 'knowledge', 'buildx'), { recursive: true });
    await writeFile(path.join(dir, 'knowledge', 'buildx', 'terminology.md'), '## Transcription lexicon\n\n| Transcript produced | Actually | Context |\n|---|---|---|\n| "loom and seed" | loam | x |\n');
    const transcript = path.join(dir, 'ep.words.json');
    await writeFile(transcript, JSON.stringify([...speak('Before the range.', 0), ...speak('Septic decides everything.', 20)]));

    const result = await executeCaptionTool('make_captions', { transcriptPath: transcript, rangeStart: 19, rangeEnd: 30 }, undefined, { knowledgeDir: path.join(dir, 'knowledge') });
    expect(result).toMatchObject({ success: true, written: true, lexiconPhrases: 1 });
    expect(result.srtPath).toBe(path.join(dir, 'ep.19-30s.srt'));
    const srt = await readFile(result.srtPath, 'utf8');
    expect(srt).toMatch(/^1\n00:00:01,000 --> /);
    expect(srt).not.toContain('Before');
    expect(await readFile(result.captionsMd, 'utf8')).toMatch(/^> Caption review/);

    const again = await executeCaptionTool('make_captions', { transcriptPath: transcript, rangeStart: 19, rangeEnd: 30 }, undefined, {});
    expect(again.written).toBe(false);
  });

  it('place_captions needs the bridge and an existing file', async () => {
    expect((await executeCaptionTool('place_captions', { srtPath: '/nope.srt', sequenceId: 's' })).error).toMatch(/bridge/);
    const bridge = jest.fn();
    expect((await executeCaptionTool('place_captions', { srtPath: '/nope.srt', sequenceId: 's' }, bridge)).error).toMatch(/No file/);
    expect(bridge).not.toHaveBeenCalled();
  });
});
