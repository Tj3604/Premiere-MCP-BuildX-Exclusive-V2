/**
 * Captions.
 *
 * Premiere caption TRACKS cannot be checked. `app.project.activeSequence.captionTracks`
 * returns `undefined` in ExtendScript — probed live through the CEP bridge on
 * 2026-08-18. There is no scripting surface at all, not a broken one, so there is
 * nothing to call and nothing to verify. This check reports SKIPPED with that
 * reason rather than inventing a pass.
 *
 * What CAN be checked is a caption OVERLAY clip — BuildX burns captions in as a
 * rendered ProRes 4444 file on a video track, and a clip is a clip. That is what
 * the second check does. It verifies the overlay exists and sits inside the
 * sequence bounds; it cannot see the words, so it never comments on wording.
 */

import { formatTimecode } from '../frames.js';
import type { QaCheck, QaIssue } from '../types.js';
import { timelineDurationSeconds } from './timeline.js';

/** Names that identify a burned-in caption overlay clip. */
export const CAPTION_CLIP_PATTERNS = ['caption', 'subtitle', 'hormozi'];

export const captionsCheck: QaCheck = {
  id: 'captions',
  title: 'Captions',
  layer: 'technical',
  support: 'EXPERIMENTAL',
  unavailableReason:
    'Premiere caption tracks are invisible to ExtendScript (captionTracks is undefined), so only a burned-in caption overlay clip can be detected.',
  async run(context) {
    if (!context.tracks || !context.sequence) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const clips = context.tracks.videoTracks.flatMap((track) =>
      track.clips.map((clip) => ({ ...clip, trackIndex: track.index }))
    );
    const captionClips = clips.filter((clip) =>
      CAPTION_CLIP_PATTERNS.some((pattern) => clip.name.toLowerCase().includes(pattern))
    );

    if (captionClips.length === 0) {
      return {
        status: 'SKIPPED',
        detail: 'no caption overlay found; caption tracks are unreadable',
        issues: [
          {
            code: 'captions_unverifiable',
            message:
              'No burned-in caption overlay clip found. If captions were added as a Premiere caption track, they cannot be verified from here — captionTracks is undefined in ExtendScript. Confirm visually.',
            autoFixable: false
          }
        ]
      };
    }

    const fps = context.sequence.fps;
    const timelineEnd = timelineDurationSeconds(context.tracks);
    const issues: QaIssue[] = [];

    for (const clip of captionClips) {
      if (clip.startTime < -1 / fps || clip.endTime > timelineEnd + 1 / fps) {
        issues.push({
          code: 'caption_out_of_bounds',
          message: `Caption overlay "${clip.name}" runs ${formatTimecode(clip.startTime, fps)}–${formatTimecode(clip.endTime, fps)}, outside the sequence bounds.`,
          timeSeconds: clip.startTime,
          autoFixable: false,
          data: { clipId: clip.id }
        });
      }
      if (clip.duration <= 0) {
        issues.push({
          code: 'caption_zero_duration',
          message: `Caption overlay "${clip.name}" has zero duration.`,
          autoFixable: false,
          data: { clipId: clip.id }
        });
      }
    }

    const detail = `${captionClips.length} overlay clip${captionClips.length === 1 ? '' : 's'}`;
    if (issues.length > 0) return { status: 'FAIL', detail, issues };
    // Present and in bounds. Whether the text sits inside the safe zone is baked
    // into the rendered overlay and can only be judged visually.
    return {
      status: 'PASS',
      detail: `${detail} (text position not machine-verifiable)`,
      issues: []
    };
  }
};
