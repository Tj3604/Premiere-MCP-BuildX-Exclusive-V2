/**
 * One-frame gap auto-fix.
 *
 * Scope is deliberately tiny. Only a gap of exactly one frame is touched, because
 * that is the known artefact of Premiere flooring source points while rounding
 * timeline positions. A larger gap may be a deliberate beat, and the policy is to
 * never close a large or ambiguous gap automatically.
 *
 * Two strategies, in order, both verified live 2026-10-06:
 *
 *  1. Extend the previous clip's tail one frame into the gap, linked audio too.
 *     Nothing downstream moves, so overlays, the logo and the end card keep
 *     their alignment, and a chain of short clips closes one gap at a time.
 *     Needs a real handle: Premiere accepts an out point past the end of the
 *     media, so the handle is proven from ffprobe stream durations, never from
 *     Premiere. Stills are never extended (writing `end` on one hangs ExtendScript).
 *
 *  2. Move the following clip back one frame, linked audio too. Only when that
 *     clip is the last on its track and nothing on another track lines up with
 *     either of its edges. Otherwise the move just relocates the gap (the next
 *     edge pulls away) or knocks an aligned overlay or end card out of step.
 *
 * Anything else is left for a human, with the reason each strategy declined.
 */

import type { QaContext, QaFix, TimelineTracks } from '../types.js';

/** A read-back within half a frame of the target is on the target frame. */
const HALF_FRAME = 0.5;
/** Slack when comparing a source out point with a stream duration, in seconds. */
const MEDIA_END_SLACK = 0.0005;

interface ItemRef {
  clipId: string;
  trackType: 'video' | 'audio';
}

function locate(tracks: TimelineTracks, ref: ItemRef) {
  const list = ref.trackType === 'audio' ? tracks.audioTracks : tracks.videoTracks;
  for (const track of list) {
    const clip = track.clips.find((candidate) => candidate.id === ref.clipId);
    if (clip) return { track, clip };
  }
  return null;
}

type StrategyOutcome =
  | { done: true; after: Record<string, unknown>; error?: string }
  | { done: false; reason: string };

/** Strategy 1: lengthen the previous clip into the gap, if its media has a frame to give. */
async function extendPrevious(
  context: QaContext,
  previousClipId: string,
  nextStart: number,
  fps: number
): Promise<StrategyOutcome> {
  const frame = 1 / fps;
  const scope = context.sequenceId ? { sequenceId: context.sequenceId } : {};
  const dry = await context.premiere.extendClipTail(previousClipId, 1, { ...scope, dryRun: true });
  if (!dry.success || !dry.items?.length) {
    return { done: false, reason: `could not read the previous clip (${dry.error ?? 'no data'})` };
  }

  const still = dry.items.find((item) => item.isStill);
  if (still) return { done: false, reason: `previous clip "${still.name}" is a still` };

  // Prove the handle from the media itself, per stream.
  const maxOut: { video?: number; audio?: number } = {};
  for (const item of dry.items) {
    const info = item.mediaPath ? await context.media.probe(item.mediaPath) : null;
    const streamEnd = item.trackType === 'audio' ? info?.audioDurationSeconds : info?.videoDurationSeconds;
    if (typeof streamEnd !== 'number') {
      return { done: false, reason: `could not measure the ${item.trackType} media of "${item.name}"` };
    }
    if (item.outPoint + frame > streamEnd + MEDIA_END_SLACK) {
      return { done: false, reason: `previous clip "${item.name}" has no ${item.trackType} handle past its out point` };
    }
    maxOut[item.trackType] = Math.min(maxOut[item.trackType] ?? Infinity, streamEnd);
  }

  const extended = await context.premiere.extendClipTail(previousClipId, 1, { ...scope, maxOutPointSeconds: maxOut });
  if (!extended.success) {
    return { done: false, reason: `extending the previous clip failed (${extended.error ?? 'no data'})` };
  }

  // Read back: every extended item must end exactly one frame later, and the
  // previous clip must now meet the next one.
  const tracks = context.sequenceId ? await context.premiere.listSequenceTracks(context.sequenceId) : null;
  if (tracks) context.tracks = tracks;
  const items = dry.items.map((item) => {
    const found = tracks ? locate(tracks, item) : null;
    const endTime = found?.clip.endTime ?? null;
    return {
      clipId: item.clipId,
      trackType: item.trackType,
      endTime,
      onTarget: endTime !== null && Math.abs((endTime - (item.endTime + frame)) * fps) <= HALF_FRAME
    };
  });
  const previousEnd = items[0]?.endTime ?? null;
  const meets = previousEnd !== null && Math.abs((nextStart - previousEnd) * fps) <= HALF_FRAME;
  const confirmed = meets && items.every((item) => item.onTarget);

  return {
    done: true,
    after: {
      strategy: 'extend_previous',
      clipId: previousClipId,
      endTime: previousEnd,
      linkedItemsExtended: items.length - 1,
      items,
      readBackConfirmed: confirmed
    },
    ...(confirmed ? {} : { error: 'Read-back does not match: the extension did not land on the next clip.' })
  };
}

/** Strategy 2: move the following clip back, if nothing depends on where it sits. */
async function moveNext(
  context: QaContext,
  nextClipId: string,
  nextStart: number,
  targetStart: number,
  fps: number
): Promise<StrategyOutcome> {
  const tracks = context.tracks;
  if (!tracks) return { done: false, reason: 'timeline state unavailable' };
  const scope = context.sequenceId ? { sequenceId: context.sequenceId } : {};

  // The dry run names the clip's linked items, which must move with it.
  const dry = await context.premiere.extendClipTail(nextClipId, 1, { ...scope, dryRun: true });
  const group: ItemRef[] = dry.success && dry.items?.length
    ? dry.items.map((item) => ({ clipId: item.clipId, trackType: item.trackType }))
    : [{ clipId: nextClipId, trackType: 'video' }];
  const groupIds = new Set(group.map((item) => item.clipId));
  const near = (a: number, b: number) => Math.abs((a - b) * fps) <= HALF_FRAME;

  for (const ref of group) {
    const found = locate(tracks, ref);
    if (!found) continue;
    const follower = found.track.clips.find(
      (clip) => !groupIds.has(clip.id) && clip.startTime >= found.clip.endTime - HALF_FRAME / fps
    );
    if (follower) {
      return {
        done: false,
        reason: `following clip is not last on its track ("${follower.name}" comes after it), so moving it would only move the gap`
      };
    }
  }

  // Moving the clip shifts both its edges, so anything lined up with either one
  // (an end card starting where it ends, a logo ending there) would fall out of
  // step and open a hole.
  const nextEnd = locate(tracks, { clipId: nextClipId, trackType: 'video' })?.clip.endTime ?? null;
  for (const track of [...tracks.videoTracks, ...tracks.audioTracks]) {
    for (const clip of track.clips) {
      if (groupIds.has(clip.id)) continue;
      for (const [edge, label] of [[nextStart, 'start'], [nextEnd, 'end']] as const) {
        if (edge !== null && (near(clip.startTime, edge) || near(clip.endTime, edge))) {
          return { done: false, reason: `"${clip.name}" is aligned to the following clip's ${label}` };
        }
      }
    }
  }

  const moved = await context.premiere.moveClip(nextClipId, targetStart, { ...scope, includeLinked: true });
  if (!moved.success) return { done: false, reason: `moving the following clip failed (${moved.error ?? 'no data'})` };

  const fresh = context.sequenceId ? await context.premiere.listSequenceTracks(context.sequenceId) : null;
  if (fresh) context.tracks = fresh;
  const shift = targetStart - nextStart;
  const movedItems = moved.moved?.length
    ? moved.moved
    : [{ clipId: nextClipId, trackType: 'video' as const, oldTime: nextStart }];
  const items = movedItems.map((item) => {
    const found = fresh ? locate(fresh, item) : null;
    const startTime = found?.clip.startTime ?? null;
    return {
      clipId: item.clipId,
      trackType: item.trackType,
      startTime,
      onTarget: startTime !== null && near(startTime, item.oldTime + shift)
    };
  });
  const confirmed = items.length > 0 && items.every((item) => item.onTarget);

  return {
    done: true,
    after: {
      strategy: 'move_next',
      clipId: nextClipId,
      startTime: items[0]?.startTime ?? null,
      linkedItemsMoved: items.length - 1,
      items,
      readBackConfirmed: confirmed
    },
    ...(confirmed ? {} : { error: 'Read-back does not match: not every moved item sits on its target frame.' })
  };
}

export const fixOneFrameGap: QaFix = {
  id: 'fix_one_frame_gap',
  handles: ['timeline_gap'],
  describe(issue) {
    return `Close the one-frame gap at ${issue.location ?? 'unknown position'} (extend the previous clip into it, or move a last clip back), linked audio included`;
  },
  async apply(issue, context) {
    const data = issue.data ?? {};
    const gapFrames = typeof data.gapFrames === 'number' ? data.gapFrames : null;
    const previousClipId = typeof data.previousClipId === 'string' ? data.previousClipId : null;
    const nextClipId = typeof data.nextClipId === 'string' ? data.nextClipId : null;
    const targetStart = typeof data.targetStart === 'number' ? data.targetStart : null;
    const nextStart = typeof data.nextClipStart === 'number' ? data.nextClipStart : null;
    const fps = context.sequence?.fps ?? null;

    if (gapFrames !== 1) {
      return {
        applied: false,
        before: null,
        after: null,
        error: `Gap is ${gapFrames} frames. Only a one-frame gap is closed automatically.`
      };
    }
    if (!previousClipId || !nextClipId || targetStart === null || nextStart === null || !fps) {
      return { applied: false, before: null, after: null, error: 'Missing clip data for the gap fix.' };
    }

    const before = { previousClipId, previousEnd: targetStart, nextClipId, nextStart, gapFrames };

    const extended = await extendPrevious(context, previousClipId, nextStart, fps);
    if (extended.done) {
      return { applied: true, before, after: extended.after, ...(extended.error ? { error: extended.error } : {}) };
    }

    const moved = await moveNext(context, nextClipId, nextStart, targetStart, fps);
    if (moved.done) {
      return {
        applied: true,
        before,
        after: { ...moved.after, extendDeclined: extended.reason },
        ...(moved.error ? { error: moved.error } : {})
      };
    }

    return {
      applied: false,
      before,
      after: null,
      error: `Left for review. Extend declined: ${extended.reason}. Move declined: ${moved.reason}.`
    };
  }
};
