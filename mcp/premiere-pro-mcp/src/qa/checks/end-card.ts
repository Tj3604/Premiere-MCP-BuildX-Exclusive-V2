/**
 * End card check.
 *
 * Every BuildX short ends on the standard card — the CTA policy is that a new one
 * is never authored, only this one appended. The card is 5.00 seconds at
 * 1080x1920 natively.
 *
 * Appending it is not treated as an auto-fix: it requires importing an asset and
 * placing a clip, which is neither a single write nor trivially reversible.
 */

import { formatTimecode } from '../frames.js';
import type { QaCheck, QaIssue, TimelineClip } from '../types.js';
import { timelineDurationSeconds } from './timeline.js';

export const endCardCheck: QaCheck = {
  id: 'end_card',
  title: 'End Card',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    const pattern = context.config.endCardPattern.trim().toLowerCase();
    if (!pattern) {
      return { status: 'SKIPPED', detail: 'not required by this workflow', issues: [] };
    }
    if (!context.tracks || !context.sequence) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const matches: Array<{ clip: TimelineClip; trackIndex: number }> = [];
    for (const track of context.tracks.videoTracks) {
      for (const clip of track.clips) {
        if (clip.name.toLowerCase().includes(pattern)) matches.push({ clip, trackIndex: track.index });
      }
    }

    if (matches.length === 0) {
      return {
        status: 'FAIL',
        detail: 'missing',
        issues: [
          {
            code: 'end_card_missing',
            message: `No clip matching "${context.config.endCardPattern}" on the timeline. Every short ends on the standard BuildX end card — never author a replacement CTA.`,
            autoFixable: false,
            data: { pattern: context.config.endCardPattern }
          }
        ]
      };
    }

    const fps = context.sequence.fps;
    const last = matches.sort((a, b) => b.clip.endTime - a.clip.endTime)[0]!;
    const timelineEnd = timelineDurationSeconds(context.tracks);
    const issues: QaIssue[] = [];

    // It has to be the last thing on the timeline, within a frame.
    if (last.clip.endTime < timelineEnd - 1 / fps) {
      issues.push({
        code: 'end_card_not_last',
        message: `End card ends at ${formatTimecode(last.clip.endTime, fps)} but the timeline runs to ${formatTimecode(timelineEnd, fps)} — something sits after it.`,
        timeSeconds: last.clip.endTime,
        autoFixable: false
      });
    }

    const expected = context.config.endCardDurationSeconds;
    const tolerance = context.config.endCardDurationToleranceSeconds;
    if (Math.abs(last.clip.duration - expected) > tolerance) {
      issues.push({
        code: 'end_card_duration',
        message: `End card runs ${last.clip.duration.toFixed(2)}s, expected ${expected.toFixed(2)}s (±${tolerance}s). The card is fully revealed by ~3.7s, so a short one cuts the offer off.`,
        timeSeconds: last.clip.startTime,
        autoFixable: false,
        data: { actual: last.clip.duration, expected, tolerance }
      });
    }

    const detail = `${last.clip.duration.toFixed(2)}s at ${formatTimecode(last.clip.startTime, fps)}`;
    if (issues.length > 0) return { status: 'REVIEW', detail, issues };
    return { status: 'PASS', detail, issues: [] };
  }
};
