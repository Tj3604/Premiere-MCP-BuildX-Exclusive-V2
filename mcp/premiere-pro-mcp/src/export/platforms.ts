/**
 * Platform versions of a finished 9:16 export: YouTube Shorts, Instagram Reels and
 * TikTok, each an H.264 High / AAC MP4 at the source frame rate, -14 LUFS / -1 dBTP,
 * under the 480 MB delivery cap, named "<export name> - <Platform>.mp4" in a
 * "Platform Versions" folder beside the export (never inside the delivery folder's
 * own listing, which the automated poster pairs by name). Nothing is overwritten.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_TARGET, Loudness, measureLoudness, normalizeLoudness } from '../audio/loudness.js';

const run = promisify(execFile);

export interface Platform {
  key: 'youtube-shorts' | 'reels' | 'tiktok';
  label: string;
  videoKbps: number;
  maxSeconds: number;
}

export const PLATFORMS: Platform[] = [
  { key: 'youtube-shorts', label: 'YouTube Shorts', videoKbps: 16000, maxSeconds: 180 },
  { key: 'reels', label: 'Reels', videoKbps: 10000, maxSeconds: 180 },
  { key: 'tiktok', label: 'TikTok', videoKbps: 10000, maxSeconds: 600 }
];

export const SIZE_CAP_MB = 480;
const AUDIO_KBPS = 192;

export interface VideoInfo {
  width: number;
  height: number;
  fps: string;
  fpsValue: number;
  duration: number;
  hasAudio: boolean;
  videoCodec: string;
  sizeMB?: number | undefined;
}

export async function probeVideo(file: string): Promise<VideoInfo> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s: any) => s.codec_type === 'video');
  if (!v) throw new Error(`No video stream in ${file}`);
  const [n, d] = String(v.r_frame_rate).split('/').map(Number);
  return {
    width: v.width,
    height: v.height,
    fps: v.r_frame_rate,
    fpsValue: d ? n! / d : n!,
    duration: Number(j.format.duration),
    hasAudio: j.streams.some((s: any) => s.codec_type === 'audio'),
    videoCodec: v.codec_name,
    sizeMB: j.format.size ? Math.round((Number(j.format.size) / 1048576) * 10) / 10 : undefined
  };
}

/**
 * Black bars by cropdetect over the middle of the clip. cropdetect logs at INFO —
 * under -v error it prints nothing and every file reads clean, so an empty result
 * is reported as "not detected", never as a pass (reference_master_broll_library).
 */
export async function detectBars(file: string, info: VideoInfo): Promise<{ bars: boolean | null; crop: string | null }> {
  // Skip the thumbnail card at the head and the dark 8s end card at the tail: their
  // near-black panel reads as bars.
  const start = info.duration * 0.15;
  const end = info.duration > 15 ? info.duration - 8.6 : info.duration * 0.8;
  const span = Math.max(0.5, Math.min(10, end - start));
  const { stderr } = await run('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'info', '-ss', start.toFixed(2), '-i', file, '-t', span.toFixed(2), '-vf', 'cropdetect=24:2:0', '-an', '-f', 'null', '-'], {
    maxBuffer: 64 * 1024 * 1024
  });
  const all = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (!all.length) return { bars: null, crop: null };
  const last = all[all.length - 1]!;
  const w = Number(last[1]);
  const h = Number(last[2]);
  return { bars: w < info.width - 8 || h < info.height - 8, crop: last[0] };
}

/** Video kbps that keeps the file under the cap, never above the platform's rate. */
export function videoKbpsFor(platform: Platform, durationSeconds: number, capMB = SIZE_CAP_MB): number {
  const budget = Math.floor(((capMB * 0.97 * 8 * 1024) / durationSeconds) - AUDIO_KBPS);
  return Math.max(500, Math.min(platform.videoKbps, budget));
}

/** "<dir>/Platform Versions/<name> - <Label>.mp4", " (2)" etc. if taken. */
export function platformOutputPath(exportPath: string, platform: Platform, exists: (p: string) => boolean = existsSync): string {
  const dir = path.join(path.dirname(exportPath), 'Platform Versions');
  const base = path.basename(exportPath, path.extname(exportPath));
  let candidate = path.join(dir, `${base} - ${platform.label}.mp4`);
  for (let n = 2; exists(candidate); n++) candidate = path.join(dir, `${base} - ${platform.label} (${n}).mp4`);
  return candidate;
}

export interface PlatformResult {
  platform: string;
  output: string;
  videoKbps: number;
  info: VideoInfo;
  loudness: Loudness | null;
  problems: string[];
}

export interface PlatformExport {
  source: string;
  sourceInfo: VideoInfo;
  sourceLoudness: Loudness | null;
  warnings: string[];
  results: PlatformResult[];
}

export async function exportPlatformVersions(exportPath: string, keys?: Platform['key'][]): Promise<PlatformExport> {
  const info = await probeVideo(exportPath);
  if (info.width * 16 !== info.height * 9) {
    throw new Error(`${path.basename(exportPath)} is ${info.width}x${info.height}, not 9:16 — platform versions are for vertical shorts.`);
  }
  const warnings: string[] = [];
  const platforms = PLATFORMS.filter((p) => !keys || keys.includes(p.key));
  const bars = await detectBars(exportPath, info);
  if (bars.bars === true) warnings.push(`Black bars detected (${bars.crop}) — shorts must fill the frame. Fix the edit; these versions keep the bars.`);
  if (bars.bars === null) warnings.push('cropdetect reported nothing — check for black bars by eye.');
  for (const p of platforms) if (info.duration > p.maxSeconds) warnings.push(`${info.duration.toFixed(1)}s is over the ${p.label} limit of ${p.maxSeconds}s — it will be rejected or cut.`);

  // One loudness pass for all three: normalize_loudness's measure-and-correct loop
  // writes a -14 LUFS AAC track once, and every version stream-copies it, so the
  // measured result is exactly what ships.
  const outDir = path.join(path.dirname(exportPath), 'Platform Versions');
  await mkdir(outDir, { recursive: true });
  let sourceLoudness: Loudness | null = null;
  let audioTrack: string | null = null;
  let audioNote: string | null = null;
  if (info.hasAudio) {
    audioTrack = path.join(outDir, `.${path.basename(exportPath, path.extname(exportPath))}.audio-${process.pid}.m4a`);
    const norm = await normalizeLoudness(exportPath, DEFAULT_TARGET, { force: true, output: audioTrack, audioOnly: true, aacKbps: AUDIO_KBPS });
    sourceLoudness = norm.before;
    audioNote = norm.note;
  } else {
    warnings.push('No audio stream — versions will be silent.');
  }

  const results: PlatformResult[] = [];
  for (const p of platforms) {
    const output = platformOutputPath(exportPath, p);
    await mkdir(path.dirname(output), { recursive: true });
    const kbps = videoKbpsFor(p, info.duration);
    const gop = String(Math.round(info.fpsValue * 2));
    const args = [
      '-nostdin', '-hide_banner', '-v', 'error', '-i', exportPath, ...(audioTrack ? ['-i', audioTrack] : []),
      '-map', '0:v:0', ...(audioTrack ? ['-map', '1:a:0'] : []),
      '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p',
      '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`, '-g', gop,
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      ...(audioTrack ? ['-c:a', 'copy'] : []),
      '-shortest', '-movflags', '+faststart', output
    ];
    await run('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 });
    const out = await probeVideo(output);
    const loud = info.hasAudio ? await measureLoudness(output) : null;
    const problems: string[] = [];
    if (out.width !== info.width || out.height !== info.height) problems.push(`size changed to ${out.width}x${out.height}`);
    if (out.fps !== info.fps) problems.push(`frame rate changed to ${out.fps}`);
    if ((out.sizeMB ?? 0) > SIZE_CAP_MB) problems.push(`${out.sizeMB} MB is over the ${SIZE_CAP_MB} MB cap`);
    if (loud && (Math.abs(loud.integratedLufs - DEFAULT_TARGET.lufs) > 0.5 || loud.truePeakDbtp > DEFAULT_TARGET.truePeak)) {
      problems.push(`loudness ${loud.integratedLufs} LUFS / ${loud.truePeakDbtp} dBTP is off target — run normalize_loudness on it`);
    }
    results.push({ platform: p.label, output, videoKbps: kbps, info: out, loudness: loud, problems });
  }
  if (audioTrack) await rm(audioTrack, { force: true });
  if (audioNote) warnings.push(`Audio: ${audioNote}`);
  return { source: exportPath, sourceInfo: info, sourceLoudness, warnings, results };
}
