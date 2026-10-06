/**
 * Loudness: measure exports (EBU R128 via ffmpeg loudnorm) and normalise them to a
 * platform target — −14 LUFS integrated, −1 dBTP true peak by default (YouTube /
 * Shorts / Reels / TikTok; presets/README.md notes −16 for podcasts).
 *
 * Measure with loudnorm (EBU R128), then apply a fixed gain plus — only when the
 * gain would push peaks past the ceiling — a 4x-oversampled true-peak limiter, and
 * measure the result again, correcting up to three passes. How hard the limiter
 * worked is reported, never hidden. Video is stream-copied. The original is never
 * written to: the result goes to a new file beside it.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Loudness {
  integratedLufs: number;
  truePeakDbtp: number;
  lra: number;
  threshold: number;
  offset: number;
}

export interface LoudnormTarget {
  lufs: number;
  truePeak: number;
  lra: number;
}

export const DEFAULT_TARGET: LoudnormTarget = { lufs: -14, truePeak: -1, lra: 11 };

/** The last {...} block loudnorm prints to stderr. */
export function parseLoudnormJson(stderr: string): Record<string, string> {
  const end = stderr.lastIndexOf('}');
  const start = stderr.lastIndexOf('{', end);
  if (start < 0 || end < 0) throw new Error('ffmpeg printed no loudnorm measurement (is there an audio stream?)');
  return JSON.parse(stderr.slice(start, end + 1));
}

function num(v: string | undefined, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`loudnorm gave no ${name} (got "${v}") — the audio may be silent`);
  return n;
}

export function toLoudness(j: Record<string, string>, prefix: 'input' | 'output' = 'input'): Loudness {
  return {
    integratedLufs: num(j[`${prefix}_i`], `${prefix}_i`),
    truePeakDbtp: num(j[`${prefix}_tp`], `${prefix}_tp`),
    lra: num(j[`${prefix}_lra`], `${prefix}_lra`),
    threshold: num(j[`${prefix}_thresh`], `${prefix}_thresh`),
    offset: Number(j['target_offset'] ?? 0)
  };
}

function filterFor(t: LoudnormTarget): string {
  return `loudnorm=I=${t.lufs}:TP=${t.truePeak}:LRA=${t.lra}:print_format=json`;
}

export async function audioCodecOf(file: string): Promise<string | null> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file]);
  return stdout.trim() || null;
}

export async function measureLoudness(file: string, target: LoudnormTarget = DEFAULT_TARGET): Promise<Loudness> {
  if (!(await audioCodecOf(file))) throw new Error(`No audio stream in ${file}`);
  const { stderr } = await run('ffmpeg', ['-nostdin', '-hide_banner', '-i', file, '-vn', '-af', filterFor(target), '-f', 'null', '-'], {
    maxBuffer: 64 * 1024 * 1024
  });
  return toLoudness(parseLoudnormJson(stderr));
}

/** "<name>-14LUFS.mp4" beside the original, or "-2", "-3"… if that exists. */
export function outputPathFor(file: string, target: LoudnormTarget, exists: (p: string) => boolean = existsSync): string {
  const ext = path.extname(file);
  const base = path.join(path.dirname(file), `${path.basename(file, ext)}-${Math.abs(target.lufs)}LUFS`);
  let candidate = `${base}${ext}`;
  for (let n = 2; exists(candidate); n++) candidate = `${base}-${n}${ext}`;
  return candidate;
}

/** Already on target: within ±0.5 LU and under the peak ceiling. */
export function onTarget(m: Loudness, t: LoudnormTarget): boolean {
  return Math.abs(m.integratedLufs - t.lufs) <= 0.5 && m.truePeakDbtp <= t.truePeak + 0.05;
}

export interface NormalizeResult {
  file: string;
  output: string | null;
  before: Loudness;
  after: Loudness | null;
  gainDb: number;
  /** linear: gain only. limited: gain plus a true-peak limiter on the loudest moments. */
  mode: 'linear' | 'limited' | 'skipped';
  /** How far the limiter pulls the loudest peaks down, dB (0 when linear). */
  peakReductionDb: number;
  passes: number;
  audioCodec: string;
  note: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Gain + true-peak limiter, at 4x sample rate so the limiter sees inter-sample peaks.
 * loudnorm's own fallback ("dynamic" mode) rides the gain like an AGC and can pump
 * speech; this keeps the gain fixed and only touches the peaks.
 */
export function chainFor(gainDb: number, limitDbfs: number | null): string {
  const parts = [`volume=${gainDb.toFixed(2)}dB`];
  if (limitDbfs !== null) {
    const lin = Math.pow(10, limitDbfs / 20).toFixed(4);
    parts.push('aresample=192000', `alimiter=limit=${lin}:attack=1:release=50:level=false`, 'aresample=48000');
  }
  return parts.join(',');
}

export async function normalizeLoudness(
  file: string,
  target: LoudnormTarget = DEFAULT_TARGET,
  { force = false }: { force?: boolean } = {}
): Promise<NormalizeResult> {
  const codecIn = await audioCodecOf(file);
  if (!codecIn) throw new Error(`No audio stream in ${file}`);
  const before = await measureLoudness(file, target);
  if (!force && onTarget(before, target)) {
    return { file, output: null, before, after: null, gainDb: 0, mode: 'skipped', peakReductionDb: 0, passes: 0, audioCodec: codecIn, note: 'Already on target — nothing written.' };
  }

  // PCM in (ProRes/broadcast masters) stays PCM; everything else goes to AAC 320k,
  // which overshoots by up to ~0.5 dB, hence the extra margin under the ceiling.
  const pcm = /^pcm_/.test(codecIn);
  const audioArgs = pcm ? ['-c:a', 'pcm_s24le'] : ['-c:a', 'aac', '-b:a', '320k'];
  const margin = pcm ? 0.3 : 0.8;
  const output = outputPathFor(file, target);

  let gain = target.lufs - before.integratedLufs;
  let limit = target.truePeak - margin;
  let after: Loudness | null = null;
  let limited = false;
  let passes = 0;
  // Up to three passes: limiting lowers the integrated level a little, and the
  // encoder can push a peak over — each pass corrects by what it measured.
  for (passes = 1; passes <= 3; passes++) {
    limited = before.truePeakDbtp + gain > limit;
    await run(
      'ffmpeg',
      ['-nostdin', '-hide_banner', '-y', '-i', file, '-map', '0:v?', '-map', '0:a:0', '-c:v', 'copy', '-af', chainFor(gain, limited ? limit : null), ...audioArgs, '-ar', '48000', '-movflags', '+faststart', output],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    after = await measureLoudness(output, target);
    const levelOff = target.lufs - after.integratedLufs;
    const peakOver = after.truePeakDbtp - target.truePeak;
    if (Math.abs(levelOff) <= 0.3 && peakOver <= 0) break;
    if (passes === 3) break;
    gain += levelOff;
    if (peakOver > 0) limit -= peakOver + 0.1;
  }

  const peakReductionDb = limited ? round1(Math.max(0, before.truePeakDbtp + gain - limit)) : 0;
  const ok = after !== null && Math.abs(target.lufs - after.integratedLufs) <= 0.5 && after.truePeakDbtp <= target.truePeak;
  const note = !ok
    ? `Missed the target after ${passes} passes — check this one by ear.`
    : limited
      ? `+${round1(gain)} dB with the loudest peaks limited by ${peakReductionDb} dB.${peakReductionDb > 6 ? ' That is heavy limiting — a louder mix from Premiere would sound better.' : ''}`
      : `Linear gain of ${gain > 0 ? '+' : ''}${round1(gain)} dB, no limiting needed.`;
  return { file, output, before, after, gainDb: round1(gain), mode: limited ? 'limited' : 'linear', peakReductionDb, passes, audioCodec: pcm ? 'pcm_s24le' : 'aac 320k', note };
}
