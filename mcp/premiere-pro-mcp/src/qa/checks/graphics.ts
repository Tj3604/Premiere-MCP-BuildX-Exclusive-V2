/**
 * Graphics presence.
 *
 * Structural only. Whether a graphic looks right, lands on the spoken word, or
 * covers a face is a visual and editorial judgement and does not belong at this
 * layer — those surface as REVIEW items from visual QA.
 */

import { formatTimecode } from '../frames.js';
import type { QaCheck, QaIssue } from '../types.js';

export const graphicsPresenceCheck: QaCheck = {
  id: 'graphics_presence',
  title: 'Graphics',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    const required = context.config.requiredGraphics.filter((entry) => entry.trim().length > 0);
    if (required.length === 0) {
      return { status: 'SKIPPED', detail: 'none required by this workflow', issues: [] };
    }
    if (!context.tracks || !context.sequence) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const allClips = context.tracks.videoTracks.flatMap((track) =>
      track.clips.map((clip) => ({ ...clip, trackIndex: track.index }))
    );
    const issues: QaIssue[] = [];
    const found: string[] = [];

    for (const requirement of required) {
      const needle = requirement.toLowerCase();
      const match = allClips.find((clip) => clip.name.toLowerCase().includes(needle));
      if (!match) {
        issues.push({
          code: 'graphic_missing',
          message: `Required graphic "${requirement}" is not on the timeline.`,
          autoFixable: false,
          data: { requirement }
        });
        continue;
      }
      found.push(requirement);
      if (match.duration <= 0) {
        issues.push({
          code: 'graphic_zero_duration',
          message: `Graphic "${match.name}" has zero duration at ${formatTimecode(match.startTime, context.sequence.fps)}.`,
          timeSeconds: match.startTime,
          autoFixable: false,
          data: { clipId: match.id }
        });
      }
    }

    const detail = `${found.length}/${required.length} present`;
    if (issues.length > 0) return { status: 'FAIL', detail, issues };
    return { status: 'PASS', detail, issues: [] };
  }
};
