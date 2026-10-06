/**
 * Timeline integrity: gaps, overlaps and duration.
 *
 * Gap detection exists because of a specific, previously shipped defect: Premiere
 * floors source in/out points but rounds timeline positions, which produced a
 * one-frame black gap between every butted clip — invisible in the tool response
 * and obvious on playback. Gaps are therefore measured in whole frames, not
 * seconds.
 */

import { formatTimecode, secondsToFrames } from '../frames.js';
import type { QaCheck, QaIssue, TimelineTrack } from '../types.js';

/** The track carrying the edit: the video track holding the most clips. */
export function primaryVideoTrack(tracks: TimelineTrack[]): TimelineTrack | null {
  let best: TimelineTrack | null = null;
  for (const track of tracks) {
    if (track.clips.length === 0) continue;
    if (!best || track.clips.length > best.clips.length) best = track;
  }
  return best;
}

function sortedClips(track: TimelineTrack) {
  return [...track.clips].sort((a, b) => a.startTime - b.startTime);
}

/**
 * A one-frame gap is the known frame-maths artefact and is the only size treated
 * as safely closable. Anything larger may be a deliberate beat and is left for a
 * human — the policy is to never close a large or ambiguous gap automatically.
 */
export const AUTO_FIXABLE_GAP_FRAMES = 1;

export const timelineGapsCheck: QaCheck = {
  id: 'timeline_gaps',
  title: 'Timeline Gaps',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.tracks || !context.sequence) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const track = primaryVideoTrack(context.tracks.videoTracks);
    if (!track || track.clips.length < 2) {
      return { status: 'PASS', detail: '0 detected', issues: [] };
    }

    const fps = context.sequence.fps;
    const clips = sortedClips(track);
    const issues: QaIssue[] = [];

    for (let i = 1; i < clips.length; i++) {
      const previous = clips[i - 1]!;
      const current = clips[i]!;
      const gapSeconds = current.startTime - previous.endTime;
      const gapFrames = secondsToFrames(gapSeconds, fps);
      if (gapFrames < 1) continue;

      const timecode = formatTimecode(previous.endTime, fps);
      const isOneFrame = gapFrames === AUTO_FIXABLE_GAP_FRAMES;
      issues.push({
        code: 'timeline_gap',
        message:
          `Gap of ${gapFrames} frame${gapFrames === 1 ? '' : 's'} at ${timecode} between "${previous.name}" and "${current.name}"` +
          (isOneFrame ? '' : ' — too large to close automatically, may be a deliberate beat'),
        location: timecode,
        timeSeconds: previous.endTime,
        autoFixable: isOneFrame,
        fixId: isOneFrame ? 'fix_one_frame_gap' : undefined,
        data: {
          gapFrames,
          gapSeconds,
          previousClipId: previous.id,
          previousClipName: previous.name,
          nextClipId: current.id,
          nextClipName: current.name,
          nextClipStart: current.startTime,
          targetStart: previous.endTime,
          trackIndex: track.index
        }
      });
    }

    if (issues.length === 0) return { status: 'PASS', detail: '0 detected', issues: [] };

    const detail = `${issues.length} detected`;
    const allAutoFixable = issues.every((issue) => issue.autoFixable);
    return { status: allAutoFixable ? 'AUTO_FIX' : 'REVIEW', detail, issues };
  }
};

export const timelineOverlapsCheck: QaCheck = {
  id: 'timeline_overlaps',
  title: 'Timeline Overlaps',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.tracks || !context.sequence) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const fps = context.sequence.fps;
    const issues: QaIssue[] = [];

    for (const track of context.tracks.videoTracks) {
      const clips = sortedClips(track);
      for (let i = 1; i < clips.length; i++) {
        const previous = clips[i - 1]!;
        const current = clips[i]!;
        const overlapFrames = secondsToFrames(previous.endTime - current.startTime, fps);
        if (overlapFrames < 1) continue;
        issues.push({
          code: 'timeline_overlap',
          message: `"${previous.name}" and "${current.name}" overlap by ${overlapFrames} frame${overlapFrames === 1 ? '' : 's'} on V${track.index + 1} at ${formatTimecode(current.startTime, fps)}`,
          location: formatTimecode(current.startTime, fps),
          timeSeconds: current.startTime,
          // Closing an overlap means deciding which clip loses frames. That is an
          // editorial call, never automatic.
          autoFixable: false,
          data: { overlapFrames, trackIndex: track.index, previousClipId: previous.id, nextClipId: current.id }
        });
      }
    }

    if (issues.length === 0) return { status: 'PASS', detail: '0 detected', issues: [] };
    return { status: 'REVIEW', detail: `${issues.length} detected`, issues };
  }
};

/** Latest end time across every video and audio track. */
export function timelineDurationSeconds(tracks: { videoTracks: TimelineTrack[]; audioTracks: TimelineTrack[] }): number {
  let latest = 0;
  for (const track of [...tracks.videoTracks, ...tracks.audioTracks]) {
    for (const clip of track.clips) {
      if (clip.endTime > latest) latest = clip.endTime;
    }
  }
  return latest;
}

export const timelineDurationCheck: QaCheck = {
  id: 'timeline_duration',
  title: 'Timeline Duration',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.tracks) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const actual = timelineDurationSeconds(context.tracks);
    const expected = context.config.expectedDurationSeconds;
    const detail = `${actual.toFixed(2)}s`;

    if (expected === undefined) {
      return { status: 'SKIPPED', detail, issues: [] };
    }

    const tolerance = context.config.durationToleranceSeconds;
    const delta = Math.abs(actual - expected);
    if (delta <= tolerance) return { status: 'PASS', detail, issues: [] };

    return {
      status: 'REVIEW',
      detail,
      issues: [
        {
          code: 'timeline_duration_mismatch',
          message: `Timeline is ${actual.toFixed(2)}s, expected ${expected.toFixed(2)}s (±${tolerance}s). Off by ${delta.toFixed(2)}s — check for a missing clip or an incorrect trim.`,
          autoFixable: false,
          data: { actual, expected, tolerance }
        }
      ]
    };
  }
};
