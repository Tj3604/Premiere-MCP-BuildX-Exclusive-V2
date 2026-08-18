/**
 * Export size enforcement.
 *
 * Adobe Media Encoder has no notion of a target file size — it encodes to whatever
 * the .epr preset says, so a 4K ProRes short trivially lands in the multi-gigabyte
 * range. This module caps a finished export at a byte budget by re-encoding it with
 * ffmpeg at a bitrate derived from the file's actual duration.
 *
 * Two-pass is deliberate. Single-pass CRF cannot hit a size target — it produces
 * whatever size the content happens to need, which is the problem we are solving.
 * Two-pass ABR lands within a few percent of the requested bitrate, so the budget
 * holds for both a static talking head and a fast-cut action edit.
 */

import { spawn } from 'child_process';
import { stat, rename, unlink, access } from 'fs/promises';
import { dirname, join, basename, extname } from 'path';

/** Default cap for every export produced by this server. */
export const DEFAULT_MAX_SIZE_MB = 480;

/**
 * Finder (and every delivery platform that quotes "MB") means 10^6 bytes, not 2^20.
 * Using the decimal megabyte keeps the number the user sees in Finder consistent
 * with the number they asked for, and is the stricter of the two readings.
 */
const BYTES_PER_MB = 1_000_000;

/**
 * Two-pass ABR overshoots slightly on hard content — container overhead and the
 * final GOP are not in the rate control's budget. Aim under the cap so the result
 * lands under it in practice rather than a few MB over.
 */
const SAFETY_FACTOR = 0.97;

/** Below this, the re-encode is doing more harm than the oversize file. */
const MIN_USABLE_VIDEO_BITRATE = 300_000;

export interface ProbeInfo {
  durationSeconds: number;
  sizeBytes: number;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  pixelFormat: string | null;
  hasAlpha: boolean;
}

/**
 * Pixel formats that carry an alpha channel.
 *
 * This matters more than it looks. The overlay renders in this pipeline are
 * ProRes 4444 (yuva444p10le) and their transparency is the entire point — h264
 * and hevc are yuv420p only, so re-encoding one drops alpha *silently* and the
 * lower third becomes an opaque black rectangle over the footage. That failure
 * is invisible until playback, so it is refused rather than warned about.
 */
const ALPHA_PIX_FMT = /^(yuva|rgba|argb|abgr|bgra|ya\d|gbrap)/;

// Optional properties are written `| undefined` throughout so callers can forward
// an absent MCP argument straight through under exactOptionalPropertyTypes.
export interface CompressOptions {
  /** Size budget in decimal MB. Defaults to DEFAULT_MAX_SIZE_MB. */
  maxSizeMB?: number | undefined;
  /** 'h264' is universally playable; 'hevc' buys ~30% quality at the same size. */
  codec?: 'h264' | 'hevc' | undefined;
  /** libx264/libx265 speed preset. Slower = smaller at equal quality. */
  preset?: string | undefined;
  /** Audio bitrate in bits/sec. */
  audioBitrate?: number | undefined;
  /**
   * Replace the source file atomically instead of writing a sibling.
   * Off by default: a render that Premiere has imported loses its media link when
   * the file underneath it is swapped.
   */
  replaceOriginal?: boolean | undefined;
  /**
   * Permit re-encoding a file that carries an alpha channel, destroying it.
   * Only set this when the transparency genuinely is not needed.
   */
  allowAlphaLoss?: boolean | undefined;
}

export interface CompressResult {
  success: boolean;
  compressed: boolean;
  reason?: string;
  error?: string;
  inputPath: string;
  outputPath?: string;
  originalSizeMB?: number;
  finalSizeMB?: number;
  maxSizeMB: number;
  withinLimit?: boolean;
  durationSeconds?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  codec?: string;
  replacedOriginal?: boolean;
  hasAlpha?: boolean;
  ffmpegStderr?: string;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

function run(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, args);
    } catch (err) {
      resolve({ code: null, stdout, stderr, spawnError: err instanceof Error ? err.message : String(err) });
      return;
    }
    // A spawn that yields no usable child (missing binary on some platforms, or a
    // stubbed child_process) must resolve rather than throw on `.on` of undefined.
    if (!proc || typeof proc.on !== 'function') {
      resolve({ code: null, stdout, stderr, spawnError: `${command} could not be started` });
      return;
    }
    proc.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', (err) => {
      resolve({ code: null, stdout, stderr, spawnError: err.message });
    });
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export async function isFfmpegAvailable(): Promise<boolean> {
  const result = await run('ffmpeg', ['-version']);
  return result.code === 0;
}

export function bytesToMB(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 100) / 100;
}

/** Reads duration and stream layout. Duration drives the whole bitrate calculation. */
export async function probe(filePath: string): Promise<ProbeInfo | null> {
  const result = await run('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  if (result.code !== 0 || !result.stdout) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }

  const streams: any[] = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find((s) => s?.codec_type === 'video');
  const audio = streams.find((s) => s?.codec_type === 'audio');
  const duration = Number(parsed?.format?.duration);
  const size = Number(parsed?.format?.size);
  const pixelFormat: string | null = typeof video?.pix_fmt === 'string' ? video.pix_fmt : null;

  return {
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    sizeBytes: Number.isFinite(size) ? size : 0,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    width: Number.isFinite(Number(video?.width)) ? Number(video.width) : null,
    height: Number.isFinite(Number(video?.height)) ? Number(video.height) : null,
    pixelFormat,
    hasAlpha: pixelFormat !== null && ALPHA_PIX_FMT.test(pixelFormat),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface WaitOptions {
  /** Give up after this long. AME renders of long 4K timelines are slow. */
  timeoutMs?: number | undefined;
  /** Size must hold steady this long before the render counts as finished. */
  stableMs?: number | undefined;
  pollMs?: number | undefined;
  /**
   * How long to wait for the output file to appear at all before concluding AME
   * never picked the job up. Without this, a queue that silently failed would
   * block the caller for the full timeoutMs.
   */
  appearTimeoutMs?: number | undefined;
}

export interface WaitResult {
  finished: boolean;
  reason: string;
  sizeBytes: number;
  waitedMs: number;
}

/**
 * Waits for an Adobe Media Encoder render to finish.
 *
 * encodeSequence() queues the job and returns immediately, so the only signal
 * available from outside AME is the output file itself: it appears, grows, then
 * stops growing. There is no completion callback to hook.
 */
export async function waitForRenderComplete(
  filePath: string,
  options: WaitOptions = {}
): Promise<WaitResult> {
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  const stableMs = options.stableMs ?? 6000;
  const pollMs = options.pollMs ?? 2000;
  const appearTimeoutMs = options.appearTimeoutMs ?? 90_000;

  const started = Date.now();
  let lastSize = -1;
  let stableSince = 0;
  let everAppeared = false;

  for (;;) {
    const waitedMs = Date.now() - started;
    if (waitedMs > timeoutMs) {
      return { finished: false, reason: 'timeout waiting for render', sizeBytes: lastSize, waitedMs };
    }

    let size = -1;
    if (await exists(filePath)) {
      everAppeared = true;
      try {
        size = (await stat(filePath)).size;
      } catch {
        size = -1;
      }
    } else if (!everAppeared && waitedMs > appearTimeoutMs) {
      // AME never started writing. Almost always a rejected queue or a bad preset;
      // waiting out the full timeout would just stall the caller.
      return {
        finished: false,
        reason: `output file never appeared within ${Math.round(appearTimeoutMs / 1000)}s — Adobe Media Encoder may not have started the job`,
        sizeBytes: -1,
        waitedMs,
      };
    }

    if (size > 0 && size === lastSize) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= stableMs) {
        return { finished: true, reason: 'output size stable', sizeBytes: size, waitedMs };
      }
    } else {
      stableSince = 0;
      lastSize = size;
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function siblingPath(filePath: string, suffix: string, ext: string): string {
  const dir = dirname(filePath);
  const stem = basename(filePath, extname(filePath));
  return join(dir, `${stem}${suffix}${ext}`);
}

/**
 * Re-encodes filePath so the result fits inside maxSizeMB.
 *
 * No-ops when the file is already inside the budget, so it is safe to call on
 * every export unconditionally.
 */
export async function compressToLimit(
  filePath: string,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const maxSizeMB = options.maxSizeMB ?? DEFAULT_MAX_SIZE_MB;
  const codec = options.codec ?? 'h264';
  const preset = options.preset ?? 'medium';
  const audioBitrate = options.audioBitrate ?? 192_000;
  const replaceOriginal = options.replaceOriginal ?? false;

  const base: CompressResult = { success: false, compressed: false, inputPath: filePath, maxSizeMB };

  if (!(await exists(filePath))) {
    return { ...base, error: `Export not found on disk: ${filePath}` };
  }
  if (!(await isFfmpegAvailable())) {
    return {
      ...base,
      error:
        'ffmpeg was not found on PATH, so the export could not be brought under the size cap. Install ffmpeg (`brew install ffmpeg` on macOS) and re-run, or pass autoCompress:false to accept the oversized file.',
    };
  }

  const info = await probe(filePath);
  if (!info) {
    return { ...base, error: `ffprobe could not read ${filePath} — cannot compute a target bitrate.` };
  }

  const originalSizeMB = bytesToMB(info.sizeBytes);

  if (info.sizeBytes <= maxSizeMB * BYTES_PER_MB) {
    return {
      ...base,
      success: true,
      compressed: false,
      reason: `already under the ${maxSizeMB} MB cap`,
      outputPath: filePath,
      originalSizeMB,
      finalSizeMB: originalSizeMB,
      withinLimit: true,
      durationSeconds: info.durationSeconds,
    };
  }

  if (!(info.durationSeconds > 0)) {
    return {
      ...base,
      originalSizeMB,
      error: 'Could not read a duration from the export, so no target bitrate can be derived.',
    };
  }

  // Refuse rather than silently flatten transparency — see ALPHA_PIX_FMT.
  if (info.hasAlpha && !(options.allowAlphaLoss ?? false)) {
    return {
      ...base,
      originalSizeMB,
      durationSeconds: info.durationSeconds,
      hasAlpha: true,
      error:
        `${filePath} carries an alpha channel (${info.pixelFormat}), and ${codec} cannot store one. ` +
        `Compressing it would silently flatten the transparency and turn the overlay into an opaque ` +
        `rectangle over the footage. Left untouched. Alpha overlays are intermediates, not deliverables — ` +
        `cap the finished edit they are used in instead. Pass allowAlphaLoss:true only if the transparency is genuinely not needed.`,
    };
  }

  const targetBits = maxSizeMB * BYTES_PER_MB * SAFETY_FACTOR * 8;
  const hasAudio = info.audioCodec !== null;
  const audioBits = hasAudio ? audioBitrate : 0;
  const videoBitrate = Math.floor(targetBits / info.durationSeconds - audioBits);

  if (videoBitrate < MIN_USABLE_VIDEO_BITRATE) {
    return {
      ...base,
      originalSizeMB,
      durationSeconds: info.durationSeconds,
      error:
        `Fitting ${Math.round(info.durationSeconds)}s into ${maxSizeMB} MB needs a video bitrate of ` +
        `${Math.max(0, videoBitrate)} bps, below the ${MIN_USABLE_VIDEO_BITRATE} bps floor. The result would be ` +
        `unwatchable. Shorten the export, raise maxSizeMB, or drop the resolution.`,
    };
  }

  const sourceExt = extname(filePath).toLowerCase();
  const outExt = sourceExt === '.mp4' || sourceExt === '.mov' ? sourceExt : '.mp4';
  const finalPath = replaceOriginal ? filePath : siblingPath(filePath, `-under${maxSizeMB}mb`, outExt);
  const workPath = siblingPath(filePath, `.compress-tmp`, outExt);
  const passLog = join(dirname(filePath), `.ffmpeg2pass-${basename(filePath, sourceExt)}`);

  const videoEncoder = codec === 'hevc' ? 'libx265' : 'libx264';
  const common = [
    '-c:v',
    videoEncoder,
    '-b:v',
    String(videoBitrate),
    '-maxrate',
    String(Math.floor(videoBitrate * 1.5)),
    '-bufsize',
    String(videoBitrate * 3),
    '-preset',
    preset,
    '-pix_fmt',
    'yuv420p',
  ];
  // libx265 takes its pass flag through -x265-params; -pass is an x264-only option.
  const passFlag = (n: 1 | 2): string[] =>
    codec === 'hevc' ? ['-x265-params', `pass=${n}:stats=${passLog}`] : ['-pass', String(n), '-passlogfile', passLog];

  const pass1 = await run('ffmpeg', [
    '-y',
    '-i',
    filePath,
    ...common,
    ...passFlag(1),
    '-an',
    '-f',
    'mp4',
    '/dev/null',
  ]);
  if (pass1.code !== 0) {
    await cleanup([passLog, `${passLog}-0.log`, `${passLog}-0.log.mbtree`, `${passLog}.cutree`]);
    return {
      ...base,
      originalSizeMB,
      durationSeconds: info.durationSeconds,
      videoBitrate,
      error: `ffmpeg pass 1 failed${pass1.spawnError ? `: ${pass1.spawnError}` : ''}`,
      ffmpegStderr: pass1.stderr.slice(-2000),
    };
  }

  const audioArgs = hasAudio ? ['-c:a', 'aac', '-b:a', String(audioBitrate)] : ['-an'];
  const tagArgs = codec === 'hevc' ? ['-tag:v', 'hvc1'] : [];
  const pass2 = await run('ffmpeg', [
    '-y',
    '-i',
    filePath,
    ...common,
    ...passFlag(2),
    ...audioArgs,
    ...tagArgs,
    '-movflags',
    '+faststart',
    workPath,
  ]);

  await cleanup([passLog, `${passLog}-0.log`, `${passLog}-0.log.mbtree`, `${passLog}.cutree`]);

  if (pass2.code !== 0 || !(await exists(workPath))) {
    await cleanup([workPath]);
    return {
      ...base,
      originalSizeMB,
      durationSeconds: info.durationSeconds,
      videoBitrate,
      error: `ffmpeg pass 2 failed${pass2.spawnError ? `: ${pass2.spawnError}` : ''}`,
      ffmpegStderr: pass2.stderr.slice(-2000),
    };
  }

  // Verify before destroying anything: a truncated re-encode is worse than an
  // oversized one, and a swap that happens first cannot be undone.
  const out = await probe(workPath);
  if (!out || out.sizeBytes <= 0) {
    await cleanup([workPath]);
    return { ...base, originalSizeMB, error: 'Re-encoded file is unreadable; the original was left untouched.' };
  }
  const durationDrift = Math.abs(out.durationSeconds - info.durationSeconds);
  if (durationDrift > 0.75) {
    await cleanup([workPath]);
    return {
      ...base,
      originalSizeMB,
      error:
        `Re-encode ran ${out.durationSeconds.toFixed(2)}s against the source's ${info.durationSeconds.toFixed(2)}s ` +
        `(${durationDrift.toFixed(2)}s drift), so it was discarded and the original left untouched.`,
    };
  }

  try {
    await rename(workPath, finalPath);
  } catch (err) {
    await cleanup([workPath]);
    return {
      ...base,
      originalSizeMB,
      error: `Could not move the compressed file into place: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const finalSizeMB = bytesToMB(out.sizeBytes);
  return {
    success: true,
    compressed: true,
    inputPath: filePath,
    outputPath: finalPath,
    originalSizeMB,
    finalSizeMB,
    maxSizeMB,
    withinLimit: out.sizeBytes <= maxSizeMB * BYTES_PER_MB,
    durationSeconds: info.durationSeconds,
    videoBitrate,
    audioBitrate: hasAudio ? audioBitrate : 0,
    codec: videoEncoder,
    replacedOriginal: replaceOriginal,
    ...(replaceOriginal
      ? {}
      : {
          reason: `original left in place at ${filePath} — pass replaceOriginal:true to swap it instead`,
        }),
  };
}

async function cleanup(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (p) => {
      try {
        await unlink(p);
      } catch {
        /* best effort */
      }
    })
  );
}
