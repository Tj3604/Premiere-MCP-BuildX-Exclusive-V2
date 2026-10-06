/**
 * File-level media inspection, via ffprobe and ffmpeg.
 *
 * This is the half of QA that does not depend on Premiere at all, and it is the
 * stronger half: an exported file is ground truth in a way a tool response is
 * not. Premiere's scripting API cannot read audio levels and its own frame export
 * is documented unreliable at arbitrary times, so measurements are taken from the
 * rendered file wherever one exists.
 *
 * `timeout(1)` does not exist on macOS, so every process is bounded by a manual
 * kill timer rather than a shell wrapper.
 */

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { Logger } from '../utils/logger.js';
import type { MediaProbe, MediaStreamInfo } from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runCommand(
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error), timedOut: false });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on('error', (error) => {
      stderr += String(error);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

export class FfmpegMediaProbe implements MediaProbe {
  private readonly logger = new Logger('QA.Media');

  constructor(
    private readonly ffprobeBin = process.env.FFPROBE_PATH ?? 'ffprobe',
    private readonly ffmpegBin = process.env.FFMPEG_PATH ?? 'ffmpeg'
  ) {}

  exists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  sizeBytes(filePath: string): number {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  }

  async probe(filePath: string): Promise<MediaStreamInfo | null> {
    if (!this.exists(filePath)) return null;
    const result = await runCommand(this.ffprobeBin, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);
    if (result.code !== 0) {
      this.logger.warn(`ffprobe failed for ${filePath}: ${result.stderr.slice(0, 200)}`);
      return null;
    }

    try {
      const parsed = JSON.parse(result.stdout) as {
        streams?: Array<Record<string, unknown>>;
        format?: Record<string, unknown>;
      };
      const streams = parsed.streams ?? [];
      const video = streams.find((stream) => stream.codec_type === 'video');
      const audio = streams.find((stream) => stream.codec_type === 'audio');
      const formatDuration = Number(parsed.format?.duration);
      const streamDuration = (stream: Record<string, unknown> | undefined) => {
        const value = Number(stream?.duration);
        return Number.isFinite(value) ? value : null;
      };

      return {
        width: video && typeof video.width === 'number' ? video.width : null,
        height: video && typeof video.height === 'number' ? video.height : null,
        durationSeconds: Number.isFinite(formatDuration) ? formatDuration : null,
        videoDurationSeconds: streamDuration(video),
        audioDurationSeconds: streamDuration(audio),
        hasVideo: video !== undefined,
        hasAudio: audio !== undefined,
        frameRate: video ? parseRational(String(video.avg_frame_rate ?? '')) : null,
        sizeBytes: this.sizeBytes(filePath)
      };
    } catch (error) {
      this.logger.warn(`Could not parse ffprobe output: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Near-black intervals. The 0.10 pixel threshold is deliberately not zero — a
   * genuinely dark shot is not a black frame, and treating every low-light cut as
   * a defect would make the check useless.
   */
  async detectBlackFrames(
    filePath: string,
    minDurationSeconds = 0.04
  ): Promise<Array<{ start: number; end: number; duration: number }>> {
    if (!this.exists(filePath)) return [];
    const result = await runCommand(this.ffmpegBin, [
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      '-vf',
      `blackdetect=d=${minDurationSeconds}:pix_th=0.10`,
      '-an',
      '-f',
      'null',
      '-'
    ]);

    const intervals: Array<{ start: number; end: number; duration: number }> = [];
    const pattern = /black_start:(\d+(?:\.\d+)?)\s+black_end:(\d+(?:\.\d+)?)\s+black_duration:(\d+(?:\.\d+)?)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(result.stderr)) !== null) {
      intervals.push({
        start: Number(match[1]),
        end: Number(match[2]),
        duration: Number(match[3])
      });
    }
    return intervals;
  }

  /** Mean and peak volume in dBFS, from ffmpeg's volumedetect. */
  async measureAudio(filePath: string): Promise<{ meanDb: number; maxDb: number } | null> {
    if (!this.exists(filePath)) return null;
    const result = await runCommand(this.ffmpegBin, [
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      '-af',
      'volumedetect',
      '-vn',
      '-f',
      'null',
      '-'
    ]);

    const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(result.stderr);
    const max = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(result.stderr);
    if (!mean || !max) return null;
    return { meanDb: Number(mean[1]), maxDb: Number(max[1]) };
  }

  /**
   * Mean luma of a still image, 0-255, via ffmpeg's signalstats. This is the only
   * part of visual QA a machine can decide on its own: a frame that is simply
   * black is objective. Everything else about a frame is a judgement call.
   */
  async meanLuma(imagePath: string): Promise<number | null> {
    if (!this.exists(imagePath)) return null;
    const result = await runCommand(this.ffmpegBin, [
      '-hide_banner',
      '-nostats',
      '-i',
      imagePath,
      '-vf',
      'signalstats,metadata=print',
      '-f',
      'null',
      '-'
    ]);
    const match = /lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/.exec(result.stderr + result.stdout);
    return match ? Number(match[1]) : null;
  }

  async extractFrame(filePath: string, timeSeconds: number, outputPath: string): Promise<string | null> {
    if (!this.exists(filePath)) return null;
    const result = await runCommand(this.ffmpegBin, [
      '-hide_banner',
      '-nostats',
      '-y',
      '-ss',
      String(Math.max(0, timeSeconds)),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outputPath
    ]);
    if (result.code !== 0 || !this.exists(outputPath)) {
      this.logger.warn(`Frame extraction failed at ${timeSeconds}s: ${result.stderr.slice(0, 200)}`);
      return null;
    }
    return outputPath;
  }
}

/** "30000/1001" -> 29.97. Returns null for the 0/0 ffprobe emits on some streams. */
export function parseRational(value: string): number | null {
  const parts = value.split('/');
  if (parts.length !== 2) {
    const single = Number(value);
    return Number.isFinite(single) && single > 0 ? single : null;
  }
  const numerator = Number(parts[0]);
  const denominator = Number(parts[1]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  const rate = numerator / denominator;
  return rate > 0 ? rate : null;
}
