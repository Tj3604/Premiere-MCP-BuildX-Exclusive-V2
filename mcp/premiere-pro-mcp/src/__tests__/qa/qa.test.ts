/**
 * QA layer tests.
 *
 * Everything Premiere-dependent runs against the stateful fake reader, which
 * mutates on write — so a test of "re-run after auto-fix" proves the state
 * actually changed, not merely that a fix function was called.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QaRunner, QA_CHECKS, QA_FIXES, loadLastReport, persistReport } from '../../qa/qa-runner.js';
import { computeFinalStatus, computeScore } from '../../qa/scoring.js';
import { resolveWorkflowConfig, listWorkflows, LOGO_ASSET_HEIGHT, LOGO_ASSET_WIDTH } from '../../qa/config.js';
import {
  aspectLabel,
  boxForPlacement,
  deriveLogoScale,
  safeZoneFor,
  safeZoneViolations
} from '../../qa/geometry.js';
import { computeMinimalReposition } from '../../qa/fixes/fix-safe-zone.js';
import { matchApprovedPlacement } from '../../qa/checks/branding.js';
import { formatTimecode, timebaseFor, timebaseMatches } from '../../qa/frames.js';
import { isRealResponse } from '../../qa/premiere-reader.js';
import { renderQaFailures, renderQaReport } from '../../qa/reports.js';
import { isQaTool, QA_TOOLS, summariseForTelemetry } from '../../qa/tools.js';
import { parseRational } from '../../qa/media.js';
import {
  defectiveProject,
  FakeMediaProbe,
  FakePremiereReader,
  healthyProject,
  logoOutsideSafeZone,
  mediaFor,
  oneFrameGapProject,
  trailingGapProject,
  twoGapProject,
  type FakeState
} from './fakes.js';
import type { QaCheckResult, QaFix, QaReport, QaStatus } from '../../qa/types.js';

const tempDirs: string[] = [];

function tempDir(prefix = 'buildx-qa-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort.
    }
  }
});

function makeRunner(state: FakeState, media = mediaFor(state), onComplete?: (r: QaReport) => void) {
  const premiere = new FakePremiereReader(state);
  const runner = new QaRunner({
    premiere,
    media,
    ...(onComplete ? { onComplete } : {})
  });
  return { runner, premiere, media };
}

function statusOf(report: QaReport, checkId: string): QaStatus | undefined {
  return [...report.technical, ...report.visual].find((result) => result.checkId === checkId)?.status;
}

const NO_VISUAL = { visualQa: false as const };

describe('geometry and safe zones', () => {
  it('identifies frame aspects', () => {
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(1920, 1080)).toBe('16:9');
    expect(aspectLabel(1080, 1350)).toBe('4:5');
    expect(aspectLabel(1728, 3072)).toBe('9:16');
  });

  it('produces the documented 9:16 safe box', () => {
    const zone = safeZoneFor(1080, 1920);
    expect(zone.left).toBeCloseTo(108, 5);
    expect(zone.right).toBeCloseTo(972, 5);
    expect(zone.top).toBeCloseTo(192, 5);
    expect(zone.bottom).toBeCloseTo(1728, 5);
  });

  it('reproduces the logo geometry recorded in safe-zones.md', () => {
    // [0.5, 0.1530] at scale 40 must put the top edge at 216px.
    const box = boxForPlacement({
      frameWidth: 1080,
      frameHeight: 1920,
      position: [0.5, 0.153],
      scalePercent: 40,
      assetWidth: LOGO_ASSET_WIDTH,
      assetHeight: LOGO_ASSET_HEIGHT
    });
    expect(box.top).toBeCloseTo(216, 0);
    expect(box.left).toBeCloseTo(340, 0);
    expect(box.right).toBeCloseTo(740, 0);
    expect(safeZoneViolations(box, safeZoneFor(1080, 1920))).toHaveLength(0);
  });

  it('catches the superseded placement that cropped off frame', () => {
    // [0.5, 0.0385417] at scale 54 put the top edge at -31px.
    const box = boxForPlacement({
      frameWidth: 1080,
      frameHeight: 1920,
      position: [0.5, 0.0385417],
      scalePercent: 54,
      assetWidth: LOGO_ASSET_WIDTH,
      assetHeight: LOGO_ASSET_HEIGHT
    });
    expect(box.top).toBeCloseTo(-31, 0);
    const violations = safeZoneViolations(box, safeZoneFor(1080, 1920));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.edge).toBe('top');
    expect(violations[0]?.overflowPx).toBeGreaterThan(200);
  });

  it('reports exact overflow in pixels', () => {
    const violations = safeZoneViolations(
      { left: 100, top: 100, right: 500, bottom: 1764 },
      safeZoneFor(1080, 1920)
    );
    const bottom = violations.find((violation) => violation.edge === 'bottom');
    expect(bottom?.overflowPx).toBe(36);
  });

  it('derives logo scale for other 9:16 resolutions', () => {
    expect(deriveLogoScale(1080)).toBe(40);
    expect(deriveLogoScale(1728)).toBe(64);
  });

  it('computes the minimal nudge back inside the zone, preserving scale', () => {
    const correction = computeMinimalReposition({
      frameWidth: 1080,
      frameHeight: 1920,
      position: [0.5, 0.0385417],
      scalePercent: 54,
      assetWidth: LOGO_ASSET_WIDTH,
      assetHeight: LOGO_ASSET_HEIGHT
    });
    expect(correction).not.toBeNull();
    const box = boxForPlacement({
      frameWidth: 1080,
      frameHeight: 1920,
      position: correction!.position,
      scalePercent: 54,
      assetWidth: LOGO_ASSET_WIDTH,
      assetHeight: LOGO_ASSET_HEIGHT
    });
    expect(safeZoneViolations(box, safeZoneFor(1080, 1920))).toHaveLength(0);
    // Horizontal placement was already fine and must not move.
    expect(correction!.position[0]).toBeCloseTo(0.5, 6);
  });

  it('refuses to reposition something larger than the safe zone', () => {
    expect(
      computeMinimalReposition({
        frameWidth: 1080,
        frameHeight: 1920,
        position: [0.5, 0.5],
        scalePercent: 200,
        assetWidth: LOGO_ASSET_WIDTH,
        assetHeight: LOGO_ASSET_HEIGHT
      })
    ).toBeNull();
  });

  it('returns null when nothing needs moving', () => {
    expect(
      computeMinimalReposition({
        frameWidth: 1080,
        frameHeight: 1920,
        position: [0.5, 0.153],
        scalePercent: 40,
        assetWidth: LOGO_ASSET_WIDTH,
        assetHeight: LOGO_ASSET_HEIGHT
      })
    ).toBeNull();
  });
});

describe('frame maths', () => {
  it('compares frame rates as integer timebases, not floats', () => {
    expect(timebaseFor({ numerator: 30000, denominator: 1001 })).toBe(8475667200);
    expect(timebaseMatches(8475667200, { numerator: 30000, denominator: 1001 })).toBe(true);
    expect(timebaseMatches(8475667200, { numerator: 30, denominator: 1 })).toBe(false);
    expect(timebaseFor({ numerator: 30, denominator: 1 })).toBe(8467200000);
    expect(timebaseMatches(8467200000, { numerator: 30, denominator: 1 })).toBe(true);
  });

  it('formats timecode', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
    expect(formatTimecode(77.4, 30)).toBe('00:01:17:12');
  });

  it('parses ffprobe rationals', () => {
    expect(parseRational('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRational('0/0')).toBeNull();
  });
});

describe('sequence format checks', () => {
  it('PASSes a correctly formatted sequence', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run(NO_VISUAL);
    expect(statusOf(report, 'sequence_resolution')).toBe('PASS');
    expect(statusOf(report, 'frame_rate')).toBe('PASS');
  });

  it('FAILs the wrong resolution and never offers to auto-fix it', async () => {
    const { runner } = makeRunner(defectiveProject());
    const report = await runner.run(NO_VISUAL);
    const result = report.technical.find((entry) => entry.checkId === 'sequence_resolution')!;
    expect(result.status).toBe('FAIL');
    expect(result.detail).toBe('1920x1080');
    expect(result.issues[0]?.autoFixable).toBe(false);
  });

  it('FAILs a frame-rate mismatch', async () => {
    const state = healthyProject();
    state.sequence!.timebase = 8467200000; // exactly 30
    const { runner } = makeRunner(state);
    const report = await runner.run(NO_VISUAL);
    expect(statusOf(report, 'frame_rate')).toBe('FAIL');
  });

  it('ERRORs rather than passing when the sequence cannot be read', async () => {
    const { runner, premiere } = makeRunner(healthyProject());
    premiere.failOn.add('getSequenceSettings');
    const report = await runner.run(NO_VISUAL);
    expect(statusOf(report, 'sequence_resolution')).toBe('ERROR');
    expect(report.finalStatus).toBe('FAILED');
  });
});

describe('timeline checks', () => {
  it('PASSes a butted timeline with no gaps', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run(NO_VISUAL);
    expect(statusOf(report, 'timeline_gaps')).toBe('PASS');
  });

  it('detects a one-frame gap and marks it AUTO_FIX', async () => {
    const { runner } = makeRunner(oneFrameGapProject());
    const report = await runner.run({ ...NO_VISUAL, autoFix: false });
    const result = report.technical.find((entry) => entry.checkId === 'timeline_gaps')!;
    expect(result.status).toBe('AUTO_FIX');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.data?.gapFrames).toBe(1);
    expect(result.issues[0]?.autoFixable).toBe(true);
    expect(result.issues[0]?.message).toContain('between "A001.MP4" and "A002.MP4"');
  });

  it('marks a large gap REVIEW and refuses to close it', async () => {
    const state = healthyProject();
    state.tracks!.videoTracks[0]!.clips[1]!.startTime = 14; // a 2s gap
    const { runner } = makeRunner(state);
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    const result = report.technical.find((entry) => entry.checkId === 'timeline_gaps')!;
    expect(result.status).toBe('REVIEW');
    expect(result.issues[0]?.autoFixable).toBe(false);
    expect(report.fixes).toHaveLength(0);
  });

  it('detects overlapping clips and never auto-fixes them', async () => {
    const state = healthyProject();
    state.tracks!.videoTracks[0]!.clips[1]!.startTime = 11;
    const { runner } = makeRunner(state);
    const report = await runner.run(NO_VISUAL);
    const result = report.technical.find((entry) => entry.checkId === 'timeline_overlaps')!;
    expect(result.status).toBe('REVIEW');
    expect(result.issues[0]?.autoFixable).toBe(false);
  });

  it('SKIPs the duration check when no expectation is configured', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run(NO_VISUAL);
    expect(statusOf(report, 'timeline_duration')).toBe('SKIPPED');
  });

  it('REVIEWs a duration outside tolerance', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run({ ...NO_VISUAL, config: { expectedDurationSeconds: 45 } });
    expect(statusOf(report, 'timeline_duration')).toBe('REVIEW');
  });
});

describe('audio, branding, end card', () => {
  it('PASSes audio that is present', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run(NO_VISUAL);
    expect(statusOf(report, 'audio_presence')).toBe('PASS');
  });

  it('FAILs when there is no audio at all', async () => {
    const state = healthyProject();
    state.tracks!.audioTracks = [];
    const { runner } = makeRunner(state);
    const report = await runner.run(NO_VISUAL);
    expect(statusOf(report, 'audio_presence')).toBe('FAIL');
  });

  it('FAILs a missing logo and does not claim it is auto-fixable', async () => {
    const { runner } = makeRunner(defectiveProject());
    const report = await runner.run(NO_VISUAL);
    const result = report.technical.find((entry) => entry.checkId === 'logo_presence')!;
    expect(result.status).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('logo_missing');
    expect(result.issues[0]?.autoFixable).toBe(false);
  });

  it('REVIEWs a logo that is razored out mid-edit', async () => {
    const state = healthyProject();
    const logoTrack = state.tracks!.videoTracks[2]!;
    logoTrack.clips = [
      { id: 'logo-1', name: 'BuildX Logo WHITE.PNG.png', startTime: 0, endTime: 10, duration: 10 },
      { id: 'logo-2', name: 'BuildX Logo WHITE.PNG.png', startTime: 15, endTime: 25, duration: 10 }
    ];
    const { runner } = makeRunner(state);
    const report = await runner.run(NO_VISUAL);
    const result = report.technical.find((entry) => entry.checkId === 'logo_presence')!;
    expect(result.status).toBe('REVIEW');
    expect(result.issues.some((issue) => issue.code === 'logo_coverage_break')).toBe(true);
  });

  it('FAILs a missing end card', async () => {
    const state = healthyProject();
    state.tracks!.videoTracks[1]!.clips = [];
    const { runner } = makeRunner(state);
    const report = await runner.run(NO_VISUAL);
    const result = report.technical.find((entry) => entry.checkId === 'end_card')!;
    expect(result.status).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('end_card_missing');
  });

  it('REVIEWs an end card of the wrong length', async () => {
    const state = healthyProject();
    const card = state.tracks!.videoTracks[1]!.clips[0]!;
    card.endTime = 27;
    card.duration = 2;
    state.tracks!.videoTracks[0]!.clips[1]!.endTime = 25;
    const { runner } = makeRunner(state);
    const report = await runner.run(NO_VISUAL);
    const result = report.technical.find((entry) => entry.checkId === 'end_card')!;
    expect(result.status).toBe('REVIEW');
    expect(result.issues.some((issue) => issue.code === 'end_card_duration')).toBe(true);
  });

  it('SKIPs the end card for a workflow that does not require one', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run({
      ...NO_VISUAL,
      workflow: 'podcast_full_episode',
      config: { requiredChecks: ['end_card'], optionalChecks: [], expectedWidth: 1080, expectedHeight: 1920 }
    });
    expect(statusOf(report, 'end_card')).toBe('SKIPPED');
  });
});

describe('captions', () => {
  it('SKIPs with an explicit reason rather than passing when nothing is readable', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run({ ...NO_VISUAL, config: { optionalChecks: ['captions'] } });
    const result = report.technical.find((entry) => entry.checkId === 'captions')!;
    expect(result.status).toBe('SKIPPED');
    expect(result.issues[0]?.message).toContain('captionTracks is undefined');
  });

  it('detects a burned-in caption overlay clip', async () => {
    const state = healthyProject();
    state.tracks!.videoTracks[1]!.clips.push({
      id: 'clip-caps',
      name: 'ep14-captions_ProRes4444.mov',
      startTime: 0,
      endTime: 25,
      duration: 25
    });
    const { runner } = makeRunner(state);
    const report = await runner.run({ ...NO_VISUAL, config: { optionalChecks: ['captions'] } });
    const result = report.technical.find((entry) => entry.checkId === 'captions')!;
    expect(result.status).toBe('PASS');
    expect(result.detail).toContain('not machine-verifiable');
  });
});

describe('export verification', () => {
  const exportPath = '/tmp/fake-export.mp4';

  function mediaWith(overrides: Partial<import('../../qa/types.js').MediaStreamInfo> = {}, extras = {}) {
    return new FakeMediaProbe(
      new Map([
        [
          exportPath,
          {
            sizeBytes: 12 * 1024 * 1024,
            info: {
              width: 1080,
              height: 1920,
              durationSeconds: 30,
              hasAudio: true,
              hasVideo: true,
              frameRate: 29.97,
              sizeBytes: 12 * 1024 * 1024,
              ...overrides
            },
            ...extras
          }
        ]
      ])
    );
  }

  it('SKIPs when no export was supplied', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run(NO_VISUAL);
    expect(statusOf(report, 'export_file')).toBe('SKIPPED');
  });

  it('FAILs when the file does not exist, whatever the export tool said', async () => {
    const { runner } = makeRunner(healthyProject(), new FakeMediaProbe());
    const report = await runner.run({ ...NO_VISUAL, exportPath });
    const result = report.technical.find((entry) => entry.checkId === 'export_file')!;
    expect(result.status).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('export_missing');
  });

  it('PASSes a real-looking export', async () => {
    const { runner } = makeRunner(healthyProject(), mediaWith());
    const report = await runner.run({ ...NO_VISUAL, exportPath });
    expect(statusOf(report, 'export_file')).toBe('PASS');
  });

  it('FAILs a truncated render', async () => {
    const { runner } = makeRunner(healthyProject(), mediaWith({ durationSeconds: 4 }));
    const report = await runner.run({ ...NO_VISUAL, exportPath });
    const result = report.technical.find((entry) => entry.checkId === 'export_file')!;
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((issue) => issue.code === 'export_duration_mismatch')).toBe(true);
  });

  it('FAILs the wrong export resolution', async () => {
    const { runner } = makeRunner(healthyProject(), mediaWith({ width: 1920, height: 1080 }));
    const report = await runner.run({ ...NO_VISUAL, exportPath });
    const result = report.technical.find((entry) => entry.checkId === 'export_file')!;
    expect(result.issues.some((issue) => issue.code === 'export_resolution_mismatch')).toBe(true);
  });

  it('FAILs a file too small to be a real render', async () => {
    const media = mediaWith();
    media.files.get(exportPath)!.sizeBytes = 2048;
    const { runner } = makeRunner(healthyProject(), media);
    const report = await runner.run({ ...NO_VISUAL, exportPath });
    const result = report.technical.find((entry) => entry.checkId === 'export_file')!;
    expect(result.issues.some((issue) => issue.code === 'export_too_small')).toBe(true);
  });

  it('rejects a relative export path', async () => {
    const { runner } = makeRunner(healthyProject(), mediaWith());
    const report = await runner.run({ ...NO_VISUAL, exportPath: 'relative/out.mp4' });
    const result = report.technical.find((entry) => entry.checkId === 'export_file')!;
    expect(result.issues[0]?.code).toBe('export_path_invalid');
  });

  it('REVIEWs interior black frames but ignores a tail fade', async () => {
    const media = mediaWith({}, { blackIntervals: [{ start: 12, end: 12.1, duration: 0.1 }, { start: 29.8, end: 30, duration: 0.2 }] });
    const { runner } = makeRunner(healthyProject(), media);
    const report = await runner.run({ ...NO_VISUAL, exportPath });
    const result = report.technical.find((entry) => entry.checkId === 'export_black_frames')!;
    expect(result.status).toBe('REVIEW');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.timeSeconds).toBe(12);
  });

  it('flags silent and clipping audio', async () => {
    const silent = mediaWith({}, { audio: { meanDb: -91, maxDb: -80 } });
    const { runner } = makeRunner(healthyProject(), silent);
    const report = await runner.run({ ...NO_VISUAL, exportPath });
    const result = report.technical.find((entry) => entry.checkId === 'export_audio_levels')!;
    expect(result.status).toBe('REVIEW');
    expect(result.issues.some((issue) => issue.code === 'audio_silent')).toBe(true);

    const clipping = mediaWith({}, { audio: { meanDb: -12, maxDb: 0 } });
    const second = makeRunner(healthyProject(), clipping);
    const report2 = await second.runner.run({ ...NO_VISUAL, exportPath });
    const result2 = report2.technical.find((entry) => entry.checkId === 'export_audio_levels')!;
    expect(result2.issues.some((issue) => issue.code === 'audio_clipping')).toBe(true);
  });
});

describe('auto-fix', () => {
  it('fixes a logo outside the safe zone and the re-run PASSes', async () => {
    const state = logoOutsideSafeZone();
    const { runner, premiere } = makeRunner(state);

    const before = await runner.run({ ...NO_VISUAL, autoFix: false });
    expect(statusOf(before, 'logo_safe_zone')).toBe('AUTO_FIX');

    const after = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(after.fixes).toHaveLength(1);
    expect(after.fixes[0]?.fixId).toBe('fix_logo_safe_zone');
    expect(after.fixes[0]?.applied).toBe(true);
    expect(after.fixes[0]?.verified).toBe(true);
    expect(after.fixes[0]?.verificationStatus).toBe('PASS');
    // The re-run is what proves it: the check now passes against real state.
    expect(statusOf(after, 'logo_safe_zone')).toBe('PASS');
    expect(premiere.calls).toContain('setParamValue');

    // Reversibility: the previous value was captured before the write.
    expect(after.fixes[0]?.before).toEqual({ position: [0.5, 0.0385417], scale: 54 });
  });

  it('closes a one-frame gap and confirms it by reading the timeline back', async () => {
    const { runner } = makeRunner(oneFrameGapProject());
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(report.fixes).toHaveLength(1);
    expect(report.fixes[0]?.fixId).toBe('fix_one_frame_gap');
    expect(report.fixes[0]?.verified).toBe(true);
    expect(statusOf(report, 'timeline_gaps')).toBe('PASS');
    expect((report.fixes[0]?.after as any)?.readBackConfirmed).toBe(true);
  });

  it('records a fix as failed when the state does not actually change', async () => {
    const { runner, premiere } = makeRunner(oneFrameGapProject());
    premiere.extendClipTailSilentlyFails = true;
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(report.fixes[0]?.applied).toBe(true);
    // The tool claimed success; the read-back says otherwise, so it is not verified.
    expect(report.fixes[0]?.verified).toBe(false);
    expect(statusOf(report, 'timeline_gaps')).toBe('AUTO_FIX');
    expect(report.finalStatus).toBe('BLOCKED');
  });

  it('records a fix as failed when the write itself fails', async () => {
    const { runner, premiere } = makeRunner(logoOutsideSafeZone());
    premiere.failOn.add('setParamValue');
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(report.fixes[0]?.applied).toBe(false);
    expect(report.fixes[0]?.verified).toBe(false);
    expect(report.fixes[0]?.error).toBeTruthy();
  });

  it('honours the retry limit and never loops on one issue', async () => {
    const { runner, premiere } = makeRunner(oneFrameGapProject());
    premiere.extendClipTailSilentlyFails = true;
    const report = await runner.run({ ...NO_VISUAL, autoFix: true, maxFixAttempts: 1 });
    expect(report.fixes).toHaveLength(1);
    expect(report.fixes.every((fix) => fix.attempt <= 1)).toBe(true);
  });

  it('does not mutate anything when auto-fix is disabled', async () => {
    const state = logoOutsideSafeZone();
    const { runner, premiere } = makeRunner(state);
    await runner.run({ ...NO_VISUAL, autoFix: false });
    expect(premiere.calls).not.toContain('setParamValue');
    expect(state.params.get('clip-logo::Motion::Position')).toEqual([0.5, 0.0385417]);
  });

  it('never auto-fixes a subjective or destructive issue', async () => {
    const state = healthyProject();
    state.tracks!.videoTracks[0]!.clips[1]!.startTime = 14; // large gap
    state.tracks!.audioTracks = []; // missing audio
    const { runner } = makeRunner(state);
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(report.fixes).toHaveLength(0);
  });
});

describe('scoring and final status', () => {
  const config = resolveWorkflowConfig('podcast_short');

  function result(checkId: string, status: QaStatus): QaCheckResult {
    return {
      checkId,
      title: checkId,
      layer: 'technical',
      support: 'VERIFIED',
      status,
      issues: [],
      durationMs: 1
    };
  }

  it('scores required checks passed over required checks executed', () => {
    const results = [
      result('sequence_resolution', 'PASS'),
      result('frame_rate', 'PASS'),
      result('timeline_gaps', 'FAIL'),
      result('audio_presence', 'PASS')
    ];
    const score = computeScore(results, config);
    expect(score.requiredExecuted).toBe(4);
    expect(score.requiredPassed).toBe(3);
    expect(score.percent).toBe(75);
  });

  it('excludes skipped checks from the denominator', () => {
    const score = computeScore(
      [result('sequence_resolution', 'PASS'), result('frame_rate', 'SKIPPED')],
      config
    );
    expect(score.requiredExecuted).toBe(1);
    expect(score.percent).toBe(100);
  });

  it('ignores optional checks in the score', () => {
    const score = computeScore(
      [result('sequence_resolution', 'PASS'), result('export_file', 'FAIL')],
      config
    );
    expect(score.requiredExecuted).toBe(1);
    expect(score.percent).toBe(100);
  });

  it('returns READY_FOR_REVIEW only when everything required passes and nothing needs eyes', () => {
    const results = config.requiredChecks.map((id) => result(id, 'PASS'));
    expect(computeFinalStatus(results, config)).toBe('READY_FOR_REVIEW');
  });

  it('returns REVIEW_REQUIRED when something subjective is outstanding', () => {
    const results = config.requiredChecks.map((id) => result(id, 'PASS'));
    results.push({ ...result('export_black_frames', 'REVIEW'), layer: 'visual' });
    expect(computeFinalStatus(results, config)).toBe('REVIEW_REQUIRED');
  });

  it('returns BLOCKED when a required check fails', () => {
    const results = config.requiredChecks.map((id) => result(id, 'PASS'));
    results[2] = result(config.requiredChecks[2]!, 'FAIL');
    expect(computeFinalStatus(results, config)).toBe('BLOCKED');
  });

  it('returns BLOCKED when a required check is still awaiting a fix', () => {
    const results = config.requiredChecks.map((id) => result(id, 'PASS'));
    results[2] = result(config.requiredChecks[2]!, 'AUTO_FIX');
    expect(computeFinalStatus(results, config)).toBe('BLOCKED');
  });

  it('returns FAILED when a required check could not execute, and never treats ERROR as PASS', () => {
    const results = config.requiredChecks.map((id) => result(id, 'PASS'));
    results[0] = result(config.requiredChecks[0]!, 'ERROR');
    expect(computeFinalStatus(results, config)).toBe('FAILED');
    expect(computeScore(results, config).percent).toBeLessThan(100);
  });

  it('has no status that means approved', () => {
    const statuses = ['READY_FOR_REVIEW', 'REVIEW_REQUIRED', 'BLOCKED', 'FAILED'];
    for (const forbidden of ['PERFECT', 'FULLY_APPROVED', 'GUARANTEED']) {
      expect(statuses).not.toContain(forbidden);
    }
  });
});

describe('first-pass versus final score', () => {
  it('records the first pass before repair and the final score after', async () => {
    const { runner } = makeRunner(logoOutsideSafeZone());
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(report.firstPassScore.percent).toBeLessThan(100);
    expect(report.finalScore.percent).toBe(100);
    expect(report.finalScore.requiredPassed).toBeGreaterThan(report.firstPassScore.requiredPassed);
  });
});

describe('one-frame gap fix (live-verified shapes, 2026-10-06)', () => {
  const clip = (state: FakeState, kind: 'video' | 'audio', id: string) =>
    (kind === 'video' ? state.tracks!.videoTracks : state.tracks!.audioTracks)
      .flatMap((track) => track.clips)
      .find((entry) => entry.id === id)!;
  const fixAfter = (report: QaReport, n = 0) => report.fixes[n]?.after as any;

  it('extends the previous clip into the gap, linked audio included, and moves nothing', async () => {
    const state = oneFrameGapProject();
    const { runner, premiere } = makeRunner(state);
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });

    expect(statusOf(report, 'timeline_gaps')).toBe('PASS');
    expect(report.fixes).toHaveLength(1);
    expect(report.fixes[0]?.verified).toBe(true);
    expect(fixAfter(report).strategy).toBe('extend_previous');
    expect(fixAfter(report).linkedItemsExtended).toBe(1);
    // The previous clip now meets the next one, and its audio ends with it.
    expect(clip(state, 'video', 'clip-a').endTime).toBeCloseTo(clip(state, 'video', 'clip-b').startTime, 6);
    expect(clip(state, 'audio', 'aud-a').endTime).toBeCloseTo(clip(state, 'video', 'clip-a').endTime, 6);
    // Nothing downstream moved: the end card and logo keep their alignment.
    expect(premiere.calls).not.toContain('moveClip');
    expect(clip(state, 'video', 'clip-cta').startTime).toBe(25);
  });

  it('closes a chain of gaps one at a time, each planned from fresh state', async () => {
    const state = twoGapProject();
    const startsBefore = ['clip-b', 'clip-c'].map((id) => clip(state, 'video', id).startTime);
    const { runner } = makeRunner(state);
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });

    expect(statusOf(report, 'timeline_gaps')).toBe('PASS');
    expect(report.fixes).toHaveLength(2);
    expect(report.fixes.every((fix) => fix.verified)).toBe(true);
    expect(['clip-b', 'clip-c'].map((id) => clip(state, 'video', id).startTime)).toEqual(startsBefore);
    for (const letter of ['a', 'b']) {
      expect(clip(state, 'audio', `aud-${letter}`).endTime).toBeCloseTo(clip(state, 'video', `clip-${letter}`).endTime, 6);
    }
  });

  it('never extends past the end of the media, which Premiere itself would allow', async () => {
    const state = twoGapProject();
    const clipLength = clip(state, 'video', 'clip-a').duration;
    const { runner, premiere } = makeRunner(state, mediaFor(state, clipLength));
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });

    expect(premiere.calls).not.toContain('extendClipTail');
    expect(premiere.calls).not.toContain('moveClip');
    expect(report.fixes.every((fix) => !fix.applied)).toBe(true);
    expect(report.fixes[0]?.error).toContain('no video handle');
    expect(report.fixes[0]?.error).toContain('not last on its track');
    expect(statusOf(report, 'timeline_gaps')).toBe('AUTO_FIX');
  });

  it('measures the handle from the video stream, not the padded container', async () => {
    const state = twoGapProject();
    const clipLength = clip(state, 'video', 'clip-a').duration;
    const media = mediaFor(state, clipLength);
    // The live shape: AAC padding makes the container a frame longer than the video.
    for (const file of media.files.values()) file.info.durationSeconds = clipLength + 0.0334;
    const { runner, premiere } = makeRunner(state, media);
    await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(premiere.calls).not.toContain('extendClipTail');
  });

  it('never extends a still', async () => {
    const state = oneFrameGapProject();
    state.sources!['clip-a']!.mediaPath = '/media/freeze.png';
    const { runner, premiere } = makeRunner(state);
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(premiere.calls).not.toContain('extendClipTail');
    expect(report.fixes[0]?.applied).toBe(false);
    expect(report.fixes[0]?.error).toContain('is a still');
  });

  it('falls back to moving a last clip, and its linked audio moves with it', async () => {
    const state = trailingGapProject();
    const { runner, premiere } = makeRunner(state, new FakeMediaProbe());
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });

    expect(statusOf(report, 'timeline_gaps')).toBe('PASS');
    expect(fixAfter(report).strategy).toBe('move_next');
    expect(fixAfter(report).linkedItemsMoved).toBe(1);
    expect(premiere.moveCalls[0]?.options.includeLinked).toBe(true);
    expect(clip(state, 'video', 'clip-b').startTime).toBeCloseTo(12, 6);
    expect(clip(state, 'audio', 'aud-b').startTime).toBeCloseTo(12, 6);
  });

  it('refuses to move a clip whose tail the end card is aligned to', async () => {
    const state = oneFrameGapProject();
    const { runner, premiere } = makeRunner(state, new FakeMediaProbe());
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(premiere.calls).not.toContain('moveClip');
    expect(report.fixes[0]?.applied).toBe(false);
    expect(report.fixes[0]?.error).toContain("aligned to the following clip's end");
  });

  it('does not confirm a move whose linked audio stayed behind', async () => {
    const state = trailingGapProject();
    const { runner, premiere } = makeRunner(state, new FakeMediaProbe());
    premiere.moveClipLeavesLinkedBehind = true;
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(report.fixes[0]?.applied).toBe(true);
    expect(report.fixes[0]?.verified).toBe(false);
    expect(fixAfter(report).readBackConfirmed).toBe(false);
    expect(report.fixes[0]?.error).toContain('Read-back does not match');
  });

  it('plans each fix from the re-run, never the first-pass snapshot', async () => {
    // A ripple-style fix shifts every later edge, so a second fix planned from the
    // first-pass snapshot would target a position that no longer exists.
    const state = twoGapProject();
    const frame = 1 / state.sequence!.fps;
    const seenTargets: number[] = [];
    const rippleFix: QaFix = {
      id: 'fix_one_frame_gap',
      handles: ['timeline_gap'],
      describe: () => 'ripple the gap closed',
      async apply(issue) {
        const from = issue.data!.nextClipStart as number;
        seenTargets.push(issue.data!.targetStart as number);
        for (const track of [...state.tracks!.videoTracks, ...state.tracks!.audioTracks]) {
          for (const entry of track.clips) {
            if (entry.startTime >= from - frame / 2) {
              entry.startTime -= frame;
              entry.endTime -= frame;
            }
          }
        }
        return { applied: true, before: {}, after: {} };
      }
    };
    const runner = new QaRunner({ premiere: new FakePremiereReader(state), media: mediaFor(state), fixes: [rippleFix] });
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });

    expect(seenTargets).toHaveLength(2);
    // Clip B ends 16 - frame before any fix and 16 - 2 frames after the first ripple.
    expect(seenTargets[1]).toBeCloseTo(16 - 2 * frame, 6);
    expect(report.fixes.every((fix) => fix.verified)).toBe(true);
    expect(statusOf(report, 'timeline_gaps')).toBe('PASS');
  });

  it('does not confirm a move that silently did nothing', async () => {
    const { runner, premiere } = makeRunner(trailingGapProject(), new FakeMediaProbe());
    premiere.moveClipSilentlyFails = true;
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(report.fixes).toHaveLength(1);
    expect(report.fixes[0]?.verified).toBe(false);
    expect(statusOf(report, 'timeline_gaps')).toBe('AUTO_FIX');
  });
});

describe('approved logo placement (Thomas, 2026-10-06)', () => {
  const shortsLogo = (x = 858, y = 308, scale = 31) => {
    const state = healthyProject();
    state.params.set('clip-logo::Motion::Position', [x / 1080, y / 1920]);
    state.params.set('clip-logo::Motion::Scale', scale);
    return state;
  };

  it('passes the upper-right shorts logo although it crosses the right safe line', async () => {
    const { runner, premiere } = makeRunner(shortsLogo());
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    const result = report.technical.find((entry) => entry.checkId === 'logo_safe_zone')!;
    expect(result.status).toBe('PASS');
    expect(result.detail).toContain('approved placement');
    expect(result.detail).toContain('right edge 41px');
    expect(premiere.calls).not.toContain('setParamValue');
    expect(report.fixes).toHaveLength(0);
  });

  it('still nudges a logo that is near, but not on, the approved placement', async () => {
    const { runner } = makeRunner(shortsLogo(880));
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(report.fixes[0]?.fixId).toBe('fix_logo_safe_zone');
  });

  it('does not carry the approval to another scale or frame size', () => {
    const placements = resolveWorkflowConfig('podcast_short').approvedLogoPlacements;
    expect(matchApprovedPlacement(placements, { width: 1080, height: 1920, position: [858 / 1080, 308 / 1920], scale: 31 })).toBeDefined();
    expect(matchApprovedPlacement(placements, { width: 1080, height: 1920, position: [858 / 1080, 308 / 1920], scale: 40 })).toBeUndefined();
    expect(matchApprovedPlacement(placements, { width: 1728, height: 3072, position: [858 / 1080, 308 / 1920], scale: 31 })).toBeUndefined();
  });

  it('applies to every vertical workflow profile', () => {
    for (const workflow of ['podcast_short', 'social_vertical', 'interview_clip', 'home_tour']) {
      expect(resolveWorkflowConfig(workflow).approvedLogoPlacements).toHaveLength(1);
    }
  });
});

describe('the controlled defective project', () => {
  it('detects every intentional defect and classifies each correctly', async () => {
    const { runner } = makeRunner(defectiveProject());
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });

    // 1 - wrong resolution: objective, unfixable, blocking
    expect(statusOf(report, 'sequence_resolution')).toBe('FAIL');
    // 2 - one-frame gap: detected. The fix runs and the read-back confirms it.
    expect(report.fixes.some((fix) => fix.fixId === 'fix_one_frame_gap')).toBe(true);
    expect(statusOf(report, 'timeline_gaps')).toBe('PASS');
    // 3 - missing logo: objective, not auto-fixable
    expect(statusOf(report, 'logo_presence')).toBe('FAIL');
    // 4 - missing end card
    expect(statusOf(report, 'end_card')).toBe('FAIL');
    // 5 - safe zone cannot be measured with no logo, so it SKIPs rather than passing
    expect(statusOf(report, 'logo_safe_zone')).toBe('SKIPPED');

    expect(report.finalStatus).toBe('BLOCKED');
    expect(report.blockingItems.length).toBeGreaterThanOrEqual(3);
  });

  it('leaves the subjective problems for a human', async () => {
    const { runner } = makeRunner(defectiveProject());
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    const fixedCodes = report.fixes.map((fix) => fix.issueCode);
    expect(fixedCodes).toEqual(['timeline_gap']);
  });
});

describe('reports', () => {
  it('renders the report sections', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run(NO_VISUAL);
    const text = renderQaReport(report);
    expect(text).toContain('BUILDX AUTOMATED QA REPORT');
    expect(text).toContain('TECHNICAL QA');
    expect(text).toContain('QA METRICS');
    expect(text).toContain('First-pass:');
    expect(text).toContain('FINAL STATUS');
    expect(text).toContain('Sequence Resolution');
  });

  it('renders failures only', async () => {
    const { runner } = makeRunner(defectiveProject());
    const report = await runner.run(NO_VISUAL);
    const text = renderQaFailures(report);
    expect(text).toContain('BUILDX QA FAILURES');
    expect(text).toContain('logo_presence');
  });

  it('persists and reloads the last report', async () => {
    const { runner } = makeRunner(healthyProject());
    const report = await runner.run(NO_VISUAL);
    const dir = tempDir();
    expect(persistReport(report, dir)).not.toBeNull();
    const reloaded = loadLastReport(dir);
    expect(reloaded?.finalStatus).toBe(report.finalStatus);
    expect(loadLastReport(tempDir())).toBeNull();
  });
});

describe('telemetry integration', () => {
  it('summarises a run into the telemetry record', async () => {
    const { runner } = makeRunner(defectiveProject());
    const report = await runner.run({ ...NO_VISUAL, autoFix: true });
    const summary = summariseForTelemetry(report);

    expect(summary.workflow).toBe('podcast_short');
    expect(summary.checksExecuted).toBeGreaterThan(0);
    expect(summary.checksFailed).toBeGreaterThan(0);
    expect(summary.autoFixesAttempted).toBe(report.fixes.length);
    expect(summary.finalStatus).toBe('BLOCKED');
    expect(summary.failedCheckIds).toContain('logo_presence');
    expect(summary.firstPassPercent).toBe(report.firstPassScore.percent);
  });

  it('calls the completion sink exactly once', async () => {
    let calls = 0;
    const { runner } = makeRunner(healthyProject(), new FakeMediaProbe(), () => {
      calls++;
    });
    await runner.run(NO_VISUAL);
    expect(calls).toBe(1);
  });

  it('survives a telemetry sink that throws', async () => {
    const { runner } = makeRunner(healthyProject(), new FakeMediaProbe(), () => {
      throw new Error('telemetry exploded');
    });
    const report = await runner.run(NO_VISUAL);
    expect(report.finalStatus).toBeDefined();
  });
});

describe('QA failure does not corrupt or interrupt the workflow', () => {
  it('reports ERROR rather than throwing when the bridge is dead', async () => {
    const { runner, premiere } = makeRunner(healthyProject());
    premiere.failOn.add('getSequenceSettings');
    premiere.failOn.add('listSequenceTracks');
    const report = await runner.run(NO_VISUAL);
    expect(report.finalStatus).toBe('FAILED');
    expect(report.technical.every((result) => result.status !== 'PASS')).toBe(true);
  });

  it('performs no mutation when checks could not run', async () => {
    const state = healthyProject();
    const { runner, premiere } = makeRunner(state);
    premiere.failOn.add('listSequenceTracks');
    await runner.run({ ...NO_VISUAL, autoFix: true });
    expect(premiere.calls).not.toContain('setParamValue');
    expect(premiere.calls).not.toContain('moveClip');
  });

  it('turns a throwing check into ERROR instead of crashing the run', async () => {
    const premiere = new FakePremiereReader(healthyProject());
    const exploding = {
      id: 'exploding',
      title: 'Exploding Check',
      layer: 'technical' as const,
      support: 'VERIFIED' as const,
      async run(): Promise<never> {
        throw new Error('check blew up');
      }
    };
    const runner = new QaRunner({
      premiere,
      media: new FakeMediaProbe(),
      checks: [...QA_CHECKS, exploding],
      fixes: QA_FIXES
    });
    const report = await runner.run({
      ...NO_VISUAL,
      config: { requiredChecks: ['exploding'], optionalChecks: [] }
    });
    const result = report.technical.find((entry) => entry.checkId === 'exploding')!;
    expect(result.status).toBe('ERROR');
    expect(result.error).toContain('check blew up');
    expect(report.finalStatus).toBe('FAILED');
  });

  it('treats a fake-success stub response as no data', () => {
    expect(isRealResponse({ success: true, name: 'X1234' })).toBe(true);
    expect(isRealResponse({ accepted: true, note: 'Expanded tool dispatched' })).toBe(false);
    expect(isRealResponse({ success: false, error: 'nope' })).toBe(false);
    expect(isRealResponse(null)).toBe(false);
  });
});

describe('workflow configuration', () => {
  it('exposes distinct profiles that do not force every check on every workflow', () => {
    expect(listWorkflows()).toEqual(
      expect.arrayContaining(['podcast_short', 'podcast_full_episode', 'youtube_landscape', 'social_vertical'])
    );
    const short = resolveWorkflowConfig('podcast_short');
    const episode = resolveWorkflowConfig('podcast_full_episode');
    expect(short.requiredChecks).toContain('end_card');
    expect(episode.requiredChecks).not.toContain('end_card');
    expect(episode.expectedWidth).toBe(1920);
    expect(short.expectedWidth).toBe(1080);
  });

  it('falls back to the default profile for an unknown workflow', () => {
    expect(resolveWorkflowConfig('nonsense').requiredChecks.length).toBeGreaterThan(0);
  });

  it('applies overrides without mutating the stored profile', () => {
    const overridden = resolveWorkflowConfig('podcast_short', { requiredChecks: ['frame_rate'] });
    expect(overridden.requiredChecks).toEqual(['frame_rate']);
    expect(resolveWorkflowConfig('podcast_short').requiredChecks.length).toBeGreaterThan(1);
  });
});

describe('QA MCP tools', () => {
  it('exposes the documented high-level surface and nothing more', () => {
    const names = QA_TOOLS.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        'apply_safe_qa_fixes',
        'get_last_qa_report',
        'get_qa_failures',
        'rerun_failed_qa_checks',
        'run_buildx_qa',
        'run_technical_qa',
        'run_visual_qa'
      ].sort()
    );
    expect(isQaTool('run_buildx_qa')).toBe(true);
    expect(isQaTool('add_to_timeline')).toBe(false);
  });
});

describe('re-running only what failed', () => {
  it('re-runs the failed checks and reflects a manual repair', async () => {
    const state = healthyProject();
    state.tracks!.audioTracks = [];
    const { runner } = makeRunner(state);
    const first = await runner.run(NO_VISUAL);
    expect(statusOf(first, 'audio_presence')).toBe('FAIL');

    // A human puts the audio back.
    state.tracks!.audioTracks = [
      {
        index: 0,
        name: 'A1',
        clipCount: 1,
        clips: [{ id: 'aud-a', name: 'A001.MP4', startTime: 0, endTime: 25, duration: 25 }]
      }
    ];

    const second = await runner.rerunFailed(first, { visualQa: false });
    expect(statusOf(second, 'audio_presence')).toBe('PASS');
    expect(second.technical.length).toBeLessThan(first.technical.length);
  });

  it('returns the previous report unchanged when nothing failed', async () => {
    const { runner } = makeRunner(healthyProject());
    const first = await runner.run(NO_VISUAL);
    const filtered: QaReport = {
      ...first,
      technical: first.technical.filter((result) => result.status === 'PASS'),
      visual: []
    };
    const second = await runner.rerunFailed(filtered, NO_VISUAL);
    expect(second).toBe(filtered);
  });
});

describe('visual QA', () => {
  it('extracts frames and returns subjective findings as REVIEW', async () => {
    const exportPath = '/tmp/visual.mp4';
    const media = new FakeMediaProbe(
      new Map([
        [
          exportPath,
          {
            sizeBytes: 5 * 1024 * 1024,
            info: {
              width: 1080,
              height: 1920,
              durationSeconds: 30,
              hasAudio: true,
              hasVideo: true,
              frameRate: 29.97,
              sizeBytes: 5 * 1024 * 1024
            },
            frameLuma: 118
          }
        ]
      ])
    );
    const { runner } = makeRunner(healthyProject(), media);
    const report = await runner.run({ visualQa: true, exportPath, frameOutputDir: tempDir() });
    const result = report.visual.find((entry) => entry.checkId === 'visual_frames')!;
    expect(result.status).toBe('REVIEW');
    expect(result.detail).toContain('from the exported file');
    expect(result.issues[0]?.code).toBe('visual_review_required');
    expect(report.finalStatus).toBe('REVIEW_REQUIRED');
  });

  it('FAILs objectively on a black sampled frame', async () => {
    const exportPath = '/tmp/black.mp4';
    const media = new FakeMediaProbe(
      new Map([
        [
          exportPath,
          {
            sizeBytes: 5 * 1024 * 1024,
            info: {
              width: 1080,
              height: 1920,
              durationSeconds: 30,
              hasAudio: true,
              hasVideo: true,
              frameRate: 29.97,
              sizeBytes: 5 * 1024 * 1024
            },
            frameLuma: 1
          }
        ]
      ])
    );
    const { runner } = makeRunner(healthyProject(), media);
    const report = await runner.run({ visualQa: true, exportPath, frameOutputDir: tempDir() });
    const result = report.visual.find((entry) => entry.checkId === 'visual_frames')!;
    expect(result.status).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('visual_black_frame');
  });

  it('never changes the edit', async () => {
    const { runner, premiere } = makeRunner(healthyProject());
    await runner.run({ visualQa: true, frameOutputDir: tempDir() });
    expect(premiere.calls).not.toContain('setParamValue');
    expect(premiere.calls).not.toContain('moveClip');
  });
});
