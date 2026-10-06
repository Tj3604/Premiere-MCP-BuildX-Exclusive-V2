/**
 * Export verification.
 *
 * A successful export call proves nothing: rendering is asynchronous, the call
 * returns before the file exists, and AME renders have been observed stalling
 * partway. So the file itself is inspected — it exists, it is big enough to be
 * real, it is readable by ffprobe, and its duration and resolution match what the
 * timeline said they would be.
 */

import path from 'node:path';
import type { QaCheck, QaIssue } from '../types.js';
import { timelineDurationSeconds } from './timeline.js';

/** Below this an "export" is a header and nothing else. */
export const MINIMUM_EXPORT_BYTES = 100 * 1024;

export const exportFileCheck: QaCheck = {
  id: 'export_file',
  title: 'Export File',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    const exportPath = context.exportPath;
    if (!exportPath) {
      return { status: 'SKIPPED', detail: 'no export supplied', issues: [] };
    }

    if (!path.isAbsolute(exportPath)) {
      return {
        status: 'FAIL',
        detail: 'relative path',
        issues: [
          {
            code: 'export_path_invalid',
            message: `Export path "${exportPath}" is not absolute.`,
            autoFixable: false
          }
        ]
      };
    }

    if (!context.media.exists(exportPath)) {
      return {
        status: 'FAIL',
        detail: 'file not found',
        issues: [
          {
            code: 'export_missing',
            message: `Export file does not exist at ${exportPath}. The export tool returning success does not mean AME finished — rendering is asynchronous.`,
            autoFixable: false,
            data: { exportPath }
          }
        ]
      };
    }

    const sizeBytes = context.media.sizeBytes(exportPath);
    const issues: QaIssue[] = [];
    if (sizeBytes < MINIMUM_EXPORT_BYTES) {
      issues.push({
        code: 'export_too_small',
        message: `Export is only ${(sizeBytes / 1024).toFixed(1)}KB — below the ${(MINIMUM_EXPORT_BYTES / 1024).toFixed(0)}KB minimum. The render probably stalled.`,
        autoFixable: false,
        data: { sizeBytes }
      });
    }

    const probe = await context.media.probe(exportPath);
    if (!probe) {
      return {
        status: 'FAIL',
        detail: `${(sizeBytes / 1024 / 1024).toFixed(1)}MB, unreadable`,
        issues: [
          ...issues,
          {
            code: 'export_unreadable',
            message: `ffprobe could not read ${exportPath}. The file exists but is not valid media.`,
            autoFixable: false
          }
        ]
      };
    }

    if (!probe.hasVideo) {
      issues.push({
        code: 'export_no_video',
        message: 'Export contains no video stream.',
        autoFixable: false
      });
    }

    const expectedWidth = context.config.expectedWidth;
    const expectedHeight = context.config.expectedHeight;
    if (probe.width !== null && probe.height !== null) {
      if (probe.width !== expectedWidth || probe.height !== expectedHeight) {
        issues.push({
          code: 'export_resolution_mismatch',
          message: `Export is ${probe.width}x${probe.height}, expected ${expectedWidth}x${expectedHeight}.`,
          autoFixable: false,
          data: { actualWidth: probe.width, actualHeight: probe.height, expectedWidth, expectedHeight }
        });
      }
    }

    // Compared against the timeline when one was read, so a truncated render is
    // caught rather than assumed complete.
    if (context.tracks && probe.durationSeconds !== null) {
      const timelineSeconds = timelineDurationSeconds(context.tracks);
      const tolerance = Math.max(context.config.durationToleranceSeconds, 0.5);
      if (timelineSeconds > 0 && Math.abs(probe.durationSeconds - timelineSeconds) > tolerance) {
        issues.push({
          code: 'export_duration_mismatch',
          message: `Export runs ${probe.durationSeconds.toFixed(2)}s but the timeline is ${timelineSeconds.toFixed(2)}s (±${tolerance}s). The render may be truncated.`,
          autoFixable: false,
          data: { exportDuration: probe.durationSeconds, timelineDuration: timelineSeconds }
        });
      }
    }

    const detail =
      `${probe.width ?? '?'}x${probe.height ?? '?'}, ` +
      `${probe.durationSeconds !== null ? `${probe.durationSeconds.toFixed(2)}s, ` : ''}` +
      `${(sizeBytes / 1024 / 1024).toFixed(1)}MB`;

    if (issues.length > 0) return { status: 'FAIL', detail, issues };
    return { status: 'PASS', detail, issues: [] };
  }
};

/**
 * Black-frame detection on the rendered file.
 *
 * This is the independent confirmation of the frame-maths gap problem: a
 * one-frame gap on the timeline shows up here as a black interval in the output.
 * The pixel threshold is deliberately not zero, so a genuinely dark shot is not
 * reported as a defect.
 */
export const exportBlackFramesCheck: QaCheck = {
  id: 'export_black_frames',
  title: 'Export Black Frames',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    const exportPath = context.exportPath;
    if (!exportPath) return { status: 'SKIPPED', detail: 'no export supplied', issues: [] };
    if (!context.media.exists(exportPath)) {
      return { status: 'ERROR', issues: [], error: `Export file not found: ${exportPath}` };
    }

    const fps = context.sequence?.fps ?? 30;
    // Two frames, so a single compressed frame of darkness is not reported.
    const minDuration = Math.max(0.04, 2 / fps);
    const intervals = await context.media.detectBlackFrames(exportPath, minDuration);

    // A fade to black at the very end is normal and is not a defect.
    const probe = await context.media.probe(exportPath);
    const duration = probe?.durationSeconds ?? null;
    const interior = intervals.filter(
      (interval) => duration === null || interval.end < duration - 0.5
    );

    if (interior.length === 0) {
      return { status: 'PASS', detail: '0 detected', issues: [] };
    }

    return {
      status: 'REVIEW',
      detail: `${interior.length} detected`,
      issues: interior.map((interval) => ({
        code: 'export_black_frames',
        message: `Black video from ${interval.start.toFixed(2)}s to ${interval.end.toFixed(2)}s (${interval.duration.toFixed(2)}s). Check for a timeline gap or a missing clip.`,
        timeSeconds: interval.start,
        location: `${interval.start.toFixed(2)}s`,
        autoFixable: false,
        data: interval as unknown as Record<string, unknown>
      }))
    };
  }
};
