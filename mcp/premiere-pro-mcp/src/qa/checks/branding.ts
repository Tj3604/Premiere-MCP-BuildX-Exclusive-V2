/**
 * Branding checks — the BuildX logo.
 *
 * The standing rule is that every short carries the logo on V3, unbroken, inside
 * the safe zone. Two separate things are checked: that the logo clip is on the
 * timeline and covers the edit, and that where it sits is actually inside the
 * safe zone.
 *
 * Position is read back from Premiere rather than assumed. If it cannot be read,
 * the check reports ERROR — it never reports PASS on the strength of the logo
 * simply being present.
 */

import { LOGO_ASSET_HEIGHT, LOGO_ASSET_WIDTH } from '../config.js';
import { formatTimecode, secondsToFrames } from '../frames.js';
import { boxForPlacement, describeViolations, safeZoneFor, safeZoneViolations } from '../geometry.js';
import type { QaCheck, QaIssue, TimelineClip, TimelineTrack } from '../types.js';

export function findLogoClips(tracks: TimelineTrack[], trackIndex: number, pattern: string): TimelineClip[] {
  const normalized = pattern.trim().toLowerCase();
  if (!normalized) return [];
  const track = tracks.find((candidate) => candidate.index === trackIndex);
  const searchTracks = track ? [track] : tracks;
  const found: TimelineClip[] = [];
  for (const candidate of searchTracks) {
    for (const clip of candidate.clips) {
      if (clip.name.toLowerCase().includes(normalized)) found.push(clip);
    }
  }
  return found.sort((a, b) => a.startTime - b.startTime);
}

export const logoPresenceCheck: QaCheck = {
  id: 'logo_presence',
  title: 'Logo',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.tracks || !context.sequence) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const { logoTrackIndex, logoAssetPattern, endCardPattern } = context.config;
    const onExpectedTrack = findLogoClips(context.tracks.videoTracks, logoTrackIndex, logoAssetPattern);
    const anywhere = findLogoClips(context.tracks.videoTracks, -1, logoAssetPattern);

    if (anywhere.length === 0) {
      return {
        status: 'FAIL',
        detail: 'missing',
        issues: [
          {
            code: 'logo_missing',
            message: `No clip matching "${logoAssetPattern}" anywhere on the timeline. Every BuildX edit carries the logo on V${logoTrackIndex + 1}.`,
            // Placing the logo means importing an asset and adding a clip: several
            // steps, not a single reversible parameter write. Left for a human.
            autoFixable: false,
            data: { expectedTrackIndex: logoTrackIndex, pattern: logoAssetPattern }
          }
        ]
      };
    }

    const issues: QaIssue[] = [];
    if (onExpectedTrack.length === 0) {
      const actualTracks = [
        ...new Set(
          context.tracks.videoTracks
            .filter((track) => track.clips.some((clip) => clip.name.toLowerCase().includes(logoAssetPattern.toLowerCase())))
            .map((track) => `V${track.index + 1}`)
        )
      ];
      issues.push({
        code: 'logo_wrong_track',
        message: `Logo is on ${actualTracks.join(', ')}, not V${logoTrackIndex + 1}.`,
        autoFixable: false,
        data: { expectedTrackIndex: logoTrackIndex, actualTracks }
      });
    }

    // Coverage: the logo runs unbroken from the top of the edit until the end
    // card begins. Cutting it out to dodge a full-frame graphic is explicitly
    // against the standing rule, so a break in coverage is reported.
    const fps = context.sequence.fps;
    const clips = onExpectedTrack.length > 0 ? onExpectedTrack : anywhere;
    const endCardClip = endCardPattern
      ? context.tracks.videoTracks
          .flatMap((track) => track.clips)
          .filter((clip) => clip.name.toLowerCase().includes(endCardPattern.toLowerCase()))
          .sort((a, b) => a.startTime - b.startTime)[0]
      : undefined;

    const requiredStart = 0;
    const requiredEnd =
      endCardClip?.startTime ??
      Math.max(...context.tracks.videoTracks.flatMap((track) => track.clips.map((clip) => clip.endTime)), 0);

    const firstClip = clips[0]!;
    if (secondsToFrames(firstClip.startTime - requiredStart, fps) > 1) {
      issues.push({
        code: 'logo_late_start',
        message: `Logo starts at ${formatTimecode(firstClip.startTime, fps)}, not at the top of the edit.`,
        timeSeconds: firstClip.startTime,
        autoFixable: false
      });
    }

    for (let i = 1; i < clips.length; i++) {
      const gapFrames = secondsToFrames(clips[i]!.startTime - clips[i - 1]!.endTime, fps);
      if (gapFrames > 1) {
        issues.push({
          code: 'logo_coverage_break',
          message: `Logo is absent for ${gapFrames} frames at ${formatTimecode(clips[i - 1]!.endTime, fps)}. The logo is never razored out mid-edit.`,
          timeSeconds: clips[i - 1]!.endTime,
          autoFixable: false
        });
      }
    }

    const lastEnd = Math.max(...clips.map((clip) => clip.endTime));
    if (requiredEnd > 0 && secondsToFrames(requiredEnd - lastEnd, fps) > 1) {
      issues.push({
        code: 'logo_early_end',
        message: `Logo ends at ${formatTimecode(lastEnd, fps)} but the edit runs to ${formatTimecode(requiredEnd, fps)}.`,
        timeSeconds: lastEnd,
        autoFixable: false
      });
    }

    const detail = `V${(onExpectedTrack[0] ? logoTrackIndex : clips[0] ? -1 : -1) + 1}, ${clips.length} clip${clips.length === 1 ? '' : 's'}`;
    if (issues.length > 0) return { status: 'REVIEW', detail, issues };
    return { status: 'PASS', detail, issues: [] };
  }
};

export const logoSafeZoneCheck: QaCheck = {
  id: 'logo_safe_zone',
  title: 'Logo Safe Zone',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.tracks || !context.sequence) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const { logoTrackIndex, logoAssetPattern } = context.config;
    const clips = findLogoClips(context.tracks.videoTracks, logoTrackIndex, logoAssetPattern);
    const target = clips[0] ?? findLogoClips(context.tracks.videoTracks, -1, logoAssetPattern)[0];
    if (!target) {
      return { status: 'SKIPPED', detail: 'no logo clip to measure', issues: [] };
    }

    const position = await context.premiere.getParamValue(target.id, 'Motion', 'Position');
    const scale = await context.premiere.getParamValue(target.id, 'Motion', 'Scale');

    if (!Array.isArray(position) || position.length < 2 || typeof scale !== 'number') {
      return {
        status: 'ERROR',
        issues: [],
        error:
          'Could not read the logo clip Motion parameters from Premiere. Safe-zone compliance cannot be confirmed without them.'
      };
    }

    const { width, height } = context.sequence;
    const box = boxForPlacement({
      frameWidth: width,
      frameHeight: height,
      position: [position[0] as number, position[1] as number],
      scalePercent: scale,
      assetWidth: LOGO_ASSET_WIDTH,
      assetHeight: LOGO_ASSET_HEIGHT
    });
    const safeZone = safeZoneFor(width, height);
    const violations = safeZoneViolations(box, safeZone);
    const detail = `top ${Math.round(box.top)}px, safe ≥ ${Math.round(safeZone.top)}px`;

    if (violations.length === 0) return { status: 'PASS', detail, issues: [] };

    return {
      status: 'AUTO_FIX',
      detail,
      issues: [
        {
          code: 'logo_safe_zone_violation',
          message: describeViolations('Logo', violations),
          autoFixable: true,
          fixId: 'fix_logo_safe_zone',
          data: {
            clipId: target.id,
            clipName: target.name,
            currentPosition: [position[0], position[1]],
            currentScale: scale,
            frameWidth: width,
            frameHeight: height,
            violations: violations as unknown as Record<string, unknown>
          }
        }
      ]
    };
  }
};
