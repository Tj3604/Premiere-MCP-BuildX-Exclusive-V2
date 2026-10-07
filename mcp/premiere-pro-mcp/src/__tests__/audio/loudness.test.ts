/**
 * Loudness: parsing, naming, the filter chain, and one real ffmpeg round trip on
 * a generated file (skipped when ffmpeg is missing).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  chainFor,
  DEFAULT_TARGET,
  measureLoudness,
  normalizeLoudness,
  onTarget,
  outputPathFor,
  parseLoudnormJson,
  toLoudness
} from '../../audio/loudness.js';

const STDERR = `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-24.10",\n\t"input_tp" : "-4.07",\n\t"input_lra" : "6.20",\n\t"input_thresh" : "-34.55",\n\t"output_i" : "-14.02",\n\t"output_tp" : "-1.00",\n\t"output_lra" : "5.10",\n\t"output_thresh" : "-24.40",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "0.02"\n}\n`;

describe('parsing', () => {
  it('reads the last loudnorm JSON block', () => {
    const m = toLoudness(parseLoudnormJson(STDERR));
    expect(m).toEqual({ integratedLufs: -24.1, truePeakDbtp: -4.07, lra: 6.2, threshold: -34.55, offset: 0.02 });
  });

  it('says so when ffmpeg printed no measurement or the audio is silent', () => {
    expect(() => parseLoudnormJson('no json here')).toThrow(/no loudnorm/);
    expect(() => toLoudness({ input_i: '-inf', input_tp: '-inf', input_lra: '0', input_thresh: '-70' })).toThrow(/silent/);
  });
});

describe('outputPathFor', () => {
  it('names the result beside the original and never reuses a name', () => {
    expect(outputPathFor('/x/Short 01.mp4', DEFAULT_TARGET, () => false)).toBe('/x/Short 01-14LUFS.mp4');
    const taken = new Set(['/x/a-14LUFS.mov', '/x/a-14LUFS-2.mov']);
    expect(outputPathFor('/x/a.mov', DEFAULT_TARGET, (p) => taken.has(p))).toBe('/x/a-14LUFS-3.mov');
    expect(outputPathFor('/x/ep.mp4', { ...DEFAULT_TARGET, lufs: -16 }, () => false)).toBe('/x/ep-16LUFS.mp4');
  });
});

describe('onTarget', () => {
  it('needs both the level within 0.5 LU and the peak under the ceiling', () => {
    const m = { integratedLufs: -14.3, truePeakDbtp: -1.2, lra: 5, threshold: -24, offset: 0 };
    expect(onTarget(m, DEFAULT_TARGET)).toBe(true);
    expect(onTarget({ ...m, truePeakDbtp: -0.5 }, DEFAULT_TARGET)).toBe(false);
    expect(onTarget({ ...m, integratedLufs: -15 }, DEFAULT_TARGET)).toBe(false);
  });
});

describe('chainFor', () => {
  it('is a plain gain when no limiting is needed', () => {
    expect(chainFor(3.9, null)).toBe('volume=3.90dB');
  });

  it('limits at 4x sample rate so inter-sample peaks are caught', () => {
    expect(chainFor(10, -1.8)).toBe('volume=10.00dB,aresample=192000,alimiter=limit=0.8128:attack=1:release=50:level=false,aresample=48000');
  });
});

let hasFfmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  hasFfmpeg = false;
}
const withFfmpeg = hasFfmpeg ? it : it.skip;

describe('normalizeLoudness (real ffmpeg)', () => {
  withFfmpeg('brings a quiet file to -14 LUFS under -1 dBTP and leaves the original alone', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bx-loud-'));
    const src = path.join(dir, 'quiet.mp4');
    // 6s of speech-like noise bursts, roughly -35 LUFS.
    execFileSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=6:c=pink:a=0.05,volume=enable=\'lt(mod(t,1),0.6)\':volume=1:eval=frame',
      '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:d=6', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', src
    ]);
    const before = await measureLoudness(src);
    const r = await normalizeLoudness(src);
    expect(r.output).toBe(path.join(dir, 'quiet-14LUFS.mp4'));
    expect(Math.abs(r.after!.integratedLufs - -14)).toBeLessThanOrEqual(0.5);
    expect(r.after!.truePeakDbtp).toBeLessThanOrEqual(-1);
    expect((await measureLoudness(src)).integratedLufs).toBeCloseTo(before.integratedLufs, 1);

    const again = await normalizeLoudness(r.output!);
    expect(again.mode).toBe('skipped');
    expect(again.output).toBeNull();
  }, 60000);
});
