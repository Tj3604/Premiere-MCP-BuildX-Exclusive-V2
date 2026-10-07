/**
 * Platform versions: naming, the size cap, and a real ffmpeg run on a generated
 * clip (skipped without ffmpeg), including the non-9:16 refusal.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportPlatformVersions, PLATFORMS, platformOutputPath, videoKbpsFor } from '../../export/platforms.js';

const shorts = PLATFORMS.find((p) => p.key === 'youtube-shorts')!;

describe('platformOutputPath', () => {
  it('names versions after the export in a Platform Versions folder, never reusing a name', () => {
    expect(platformOutputPath('/d/Exports/Short 03 - Title.mp4', shorts, () => false)).toBe('/d/Exports/Platform Versions/Short 03 - Title - YouTube Shorts.mp4');
    const taken = new Set(['/d/Platform Versions/a - TikTok.mp4']);
    const tiktok = PLATFORMS.find((p) => p.key === 'tiktok')!;
    expect(platformOutputPath('/d/a.mov', tiktok, (p) => taken.has(p))).toBe('/d/Platform Versions/a - TikTok (2).mp4');
  });
});

describe('videoKbpsFor', () => {
  it('uses the platform rate for a short clip', () => {
    expect(videoKbpsFor(shorts, 45)).toBe(16000);
  });

  it('drops the rate so a long clip stays under the 480 MB cap', () => {
    const kbps = videoKbpsFor(shorts, 600);
    expect(kbps).toBeLessThan(16000);
    expect(((kbps + 192) * 600) / 8 / 1024).toBeLessThan(480);
  });
});

let hasFfmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  hasFfmpeg = false;
}
const withFfmpeg = hasFfmpeg ? it : it.skip;

describe('exportPlatformVersions (real ffmpeg)', () => {
  function make(dir: string, name: string, size: string): string {
    const file = path.join(dir, name);
    execFileSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${size}:r=30000/1001:d=4`,
      '-f', 'lavfi', '-i', 'anoisesrc=d=4:c=pink:a=0.05', '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file
    ]);
    return file;
  }

  withFfmpeg('writes all three on target and keeps the frame rate', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bx-plat-'));
    const src = make(dir, 'Short 01 - Test.mp4', '540x960');
    const r = await exportPlatformVersions(src);
    expect(r.results.map((x) => x.platform)).toEqual(['YouTube Shorts', 'Reels', 'TikTok']);
    for (const x of r.results) {
      expect(existsSync(x.output)).toBe(true);
      expect(x.info.fps).toBe('30000/1001');
      expect(x.problems).toEqual([]);
    }
    expect(existsSync(path.join(dir, 'Platform Versions'))).toBe(true);
  }, 120000);

  withFfmpeg('refuses a landscape file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bx-plat-'));
    const src = make(dir, 'wide.mp4', '960x540');
    await expect(exportPlatformVersions(src)).rejects.toThrow(/not 9:16/);
  }, 60000);
});
