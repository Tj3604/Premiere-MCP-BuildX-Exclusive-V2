/**
 * Media-layer integration tests.
 *
 * These run against REAL files built with ffmpeg, and exercise the real
 * FfmpegMediaProbe rather than a fake. This is the half of QA that needs no
 * Premiere, so it can be verified end to end here: a genuine 1080x1920 clip with
 * a genuine two-second black hole in the middle, checked by genuine ffprobe.
 *
 * Skipped automatically when ffmpeg is not on PATH.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FfmpegMediaProbe, runCommand } from '../../qa/media.js';
import { exportBlackFramesCheck, exportFileCheck } from '../../qa/checks/export.js';
import { exportAudioLevelsCheck } from '../../qa/checks/audio.js';
import { visualFramesCheck } from '../../qa/checks/visual-qa.js';
import { resolveWorkflowConfig } from '../../qa/config.js';
import type { QaContext } from '../../qa/types.js';
import { FakePremiereReader, healthyProject } from './fakes.js';

const probe = new FfmpegMediaProbe();
let ffmpegAvailable = false;
let workDir = '';
let goodExport = '';
let blackHoleExport = '';

/** ffmpeg renders are slow; every test in this file gets a generous budget. */
const TEST_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  const version = await runCommand('ffmpeg', ['-version'], 10_000);
  ffmpegAvailable = version.code === 0;
  if (!ffmpegAvailable) return;

  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildx-qa-media-'));
  goodExport = path.join(workDir, 'good.mp4');
  blackHoleExport = path.join(workDir, 'blackhole.mp4');

  // A clean 6s 1080x1920 29.97 clip with a tone, standing in for a short.
  await runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30000/1001:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-filter:a', 'volume=-18dB',
    '-shortest', goodExport
  ]);

  // The same, with a deliberate 2s black hole from 2s to 4s — the defect a
  // one-frame timeline gap eventually becomes in a rendered file.
  await runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30000/1001:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-filter_complex', "[0:v]drawbox=x=0:y=0:w=1080:h=1920:color=black@1:t=fill:enable='between(t,2,4)'[v]",
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-shortest', blackHoleExport
  ]);
}, TEST_TIMEOUT_MS);

afterAll(() => {
  if (workDir) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Best effort.
    }
  }
});

function contextFor(exportPath: string, durationSeconds: number): QaContext {
  const state = healthyProject();
  // Match the fixture timeline to the real file so the duration check is meaningful.
  state.tracks!.videoTracks[0]!.clips = [
    { id: 'clip-a', name: 'A001.MP4', startTime: 0, endTime: durationSeconds, duration: durationSeconds }
  ];
  state.tracks!.videoTracks[1]!.clips = [];
  state.tracks!.videoTracks[2]!.clips = [];
  state.tracks!.audioTracks[0]!.clips = [
    { id: 'aud-a', name: 'A001.MP4', startTime: 0, endTime: durationSeconds, duration: durationSeconds }
  ];
  return {
    config: resolveWorkflowConfig('podcast_short'),
    sequenceId: 'seq-1',
    exportPath,
    frameOutputDir: path.join(workDir, `frames-${path.basename(exportPath)}`),
    premiere: new FakePremiereReader(state),
    media: probe,
    sequence: state.sequence,
    tracks: state.tracks
  };
}

const maybe = (name: string, fn: () => Promise<void>) =>
  it(
    name,
    async () => {
      if (!ffmpegAvailable) {
        console.warn('ffmpeg not available — skipping media integration test');
        return;
      }
      await fn();
    },
    TEST_TIMEOUT_MS
  );

describe('real ffprobe inspection', () => {
  maybe('reads resolution, duration and streams from an actual file', async () => {
    const info = await probe.probe(goodExport);
    expect(info).not.toBeNull();
    expect(info!.width).toBe(1080);
    expect(info!.height).toBe(1920);
    expect(info!.hasVideo).toBe(true);
    expect(info!.hasAudio).toBe(true);
    expect(info!.durationSeconds).toBeGreaterThan(5.5);
    expect(info!.frameRate).toBeCloseTo(29.97, 1);
    expect(info!.sizeBytes).toBeGreaterThan(1000);
  });

  maybe('returns null for a file that is not media', async () => {
    const junk = path.join(workDir, 'junk.mp4');
    fs.writeFileSync(junk, 'this is not a video');
    expect(await probe.probe(junk)).toBeNull();
  });

  maybe('reports a missing file rather than throwing', async () => {
    expect(probe.exists('/nope/missing.mp4')).toBe(false);
    expect(await probe.probe('/nope/missing.mp4')).toBeNull();
  });
});

describe('export checks against a real render', () => {
  maybe('PASSes a genuine, complete export', async () => {
    const context = contextFor(goodExport, 6);
    const result = await exportFileCheck.run(context);
    expect(result.status).toBe('PASS');
    expect(result.detail).toContain('1080x1920');
  });

  maybe('FAILs when the timeline is longer than the rendered file', async () => {
    const context = contextFor(goodExport, 30);
    const result = await exportFileCheck.run(context);
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((issue) => issue.code === 'export_duration_mismatch')).toBe(true);
  });

  maybe('FAILs a file that exists but is not readable media', async () => {
    const junk = path.join(workDir, 'junk2.mp4');
    fs.writeFileSync(junk, Buffer.alloc(200 * 1024));
    const context = contextFor(junk, 6);
    const result = await exportFileCheck.run(context);
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((issue) => issue.code === 'export_unreadable')).toBe(true);
  });
});

describe('black-frame detection against a real defect', () => {
  maybe('finds the deliberate black hole and leaves the clean file alone', async () => {
    const clean = await exportBlackFramesCheck.run(contextFor(goodExport, 6));
    expect(clean.status).toBe('PASS');

    const defective = await exportBlackFramesCheck.run(contextFor(blackHoleExport, 6));
    expect(defective.status).toBe('REVIEW');
    expect(defective.issues.length).toBeGreaterThan(0);
    const first = defective.issues[0]!;
    expect(first.timeSeconds).toBeGreaterThanOrEqual(1.9);
    expect(first.timeSeconds).toBeLessThanOrEqual(2.5);
  });
});

describe('audio measurement against real audio', () => {
  maybe('measures mean and peak from the file', async () => {
    const levels = await probe.measureAudio(goodExport);
    expect(levels).not.toBeNull();
    expect(levels!.meanDb).toBeLessThan(0);
    expect(levels!.maxDb).toBeLessThanOrEqual(0);
  });

  maybe('PASSes sane levels', async () => {
    const result = await exportAudioLevelsCheck.run(contextFor(goodExport, 6));
    expect(['PASS', 'REVIEW']).toContain(result.status);
  });

  maybe('flags a genuinely silent render', async () => {
    const silent = path.join(workDir, 'silent.mp4');
    await runCommand('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', silent
    ]);
    const result = await exportAudioLevelsCheck.run(contextFor(silent, 3));
    expect(result.status).toBe('REVIEW');
    expect(result.issues.some((issue) => issue.code === 'audio_silent')).toBe(true);
  });
});

describe('visual QA against real frames', () => {
  maybe('extracts real stills and screens them for black', async () => {
    const context = contextFor(goodExport, 6);
    const result = await visualFramesCheck.run(context);
    expect(result.status).toBe('REVIEW');
    expect(result.detail).toContain('from the exported file');

    const frames = (result.issues[0]?.data?.frames ?? []) as Array<{ imagePath: string; meanLuma: number }>;
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(fs.existsSync(frame.imagePath)).toBe(true);
      expect(frame.meanLuma).toBeGreaterThan(0);
    }
  });

  maybe('objectively FAILs on a real black frame', async () => {
    const context = contextFor(blackHoleExport, 6);
    // Sample squarely inside the black hole.
    context.config = { ...context.config, visualSamplePoints: [0.5] };
    const result = await visualFramesCheck.run(context);
    expect(result.status).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('visual_black_frame');
  });
});
