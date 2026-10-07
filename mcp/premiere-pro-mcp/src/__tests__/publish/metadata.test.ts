/**
 * Upload metadata checks: limits, hashtags, figures, drywall, CTA, and the
 * measured title warnings — plus the save tool refusing bad text.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkMetadata, composed, figures, type UploadMetadata } from '../../publish/metadata.js';
import { executePublishTool } from '../../publish/tools.js';

const TRANSCRIPT = 'This is a 200 amp panel. The new code needs a 60 amp circuit. Going from 150 to 200 is peanuts.';

function good(): UploadMetadata {
  return {
    youtube: { title: 'Why We Always Put In a 200 Amp Panel', text: 'The new code needs a 60 amp circuit.', hashtags: ['#shorts', '#ADU', '#electrical'] },
    instagram: { text: 'From 150 to 200 amps is peanuts.', hashtags: ['#ADU', '#electrical', '#homebuilding'] },
    tiktok: { text: 'Why every panel is 200 amps.', hashtags: ['#ADU', '#electrician', '#homebuilding'] }
  };
}

describe('figures', () => {
  it('reads numbers as written, money and commas included', () => {
    expect(figures('It cost $40,000 for 1.5 acres and 200 amps')).toEqual([40000, 1.5, 200]);
  });
});

describe('checkMetadata', () => {
  it('passes clean text with no warnings', () => {
    expect(checkMetadata(good(), TRANSCRIPT)).toEqual({ errors: [], warnings: [] });
  });

  it('rejects a figure that was never said', () => {
    const m = good();
    m.instagram.text = 'Save $25,000 on your panel.';
    expect(checkMetadata(m, TRANSCRIPT).errors.join()).toMatch(/25000 is not in the transcript/);
  });

  it('rejects a call to action and "drywall"', () => {
    const m = good();
    m.tiktok.text = 'Link in bio for the drywall details.';
    const e = checkMetadata(m, TRANSCRIPT).errors.join(' | ');
    expect(e).toMatch(/call to action/);
    expect(e).toMatch(/thin coat plaster/);
  });

  it('enforces hashtag count, format, duplicates and #shorts', () => {
    const m = good();
    m.youtube.hashtags = ['#ADU', '#electrical', '#home'];
    m.instagram.hashtags = ['#ADU', '#adu', 'electrical'];
    m.tiktok.hashtags = ['#a', '#b', '#c', '#d', '#e', '#f'];
    const e = checkMetadata(m, TRANSCRIPT).errors.join(' | ');
    expect(e).toMatch(/add #shorts/);
    expect(e).toMatch(/repeated hashtag/);
    expect(e).toMatch(/"electrical" is not a hashtag/);
    expect(e).toMatch(/tiktok: 6 hashtags/);
  });

  it('enforces platform lengths, counting the hashtags', () => {
    const m = good();
    m.instagram.text = 'x'.repeat(2190);
    expect(checkMetadata(m, TRANSCRIPT).errors.join()).toMatch(/instagram: \d+ characters with hashtags, over the 2200 limit/);
    m.youtube.title = 'y'.repeat(101);
    expect(checkMetadata(m, TRANSCRIPT).errors.join()).toMatch(/title is 101 characters/);
  });

  it('warns on the measured losing title patterns', () => {
    const m = good();
    m.youtube.title = 'BuildX Panels Explained';
    const w = checkMetadata(m, TRANSCRIPT).warnings.join(' | ');
    expect(w).toMatch(/opens with "BuildX"/);
    expect(w).toMatch(/no number in the title/);
  });
});

describe('composed', () => {
  it('puts the hashtags on their own line', () => {
    expect(composed({ text: 'Hi.', hashtags: ['#a', '#b'] })).toBe('Hi.\n\n#a #b');
  });
});

describe('save_upload_metadata', () => {
  it('refuses bad text and writes good text into Platform Versions, never overwriting', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bx-meta-'));
    const transcript = path.join(dir, 'clip.txt');
    writeFileSync(transcript, TRANSCRIPT);
    const exportPath = path.join(dir, 'Short 18 - Test.mp4');

    const bad = good();
    bad.youtube.text = 'Call us today.';
    const refused = await executePublishTool('save_upload_metadata', { exportPath, transcriptPath: transcript, metadata: bad });
    expect(refused).toMatchObject({ success: false, saved: false });

    const ok = await executePublishTool('save_upload_metadata', { exportPath, transcriptPath: transcript, metadata: good() });
    expect(ok.json).toBe(path.join(dir, 'Platform Versions', 'Short 18 - Test - Upload.json'));
    expect(JSON.parse(readFileSync(ok.json, 'utf8')).youtube.posted).toMatch(/#shorts #ADU #electrical$/);
    const again = await executePublishTool('save_upload_metadata', { exportPath, transcriptPath: transcript, metadata: good() });
    expect(again.errors.join()).toMatch(/already exists/);
  });
});
