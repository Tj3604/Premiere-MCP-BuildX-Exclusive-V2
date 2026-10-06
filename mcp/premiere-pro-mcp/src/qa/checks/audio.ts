/**
 * Audio checks.
 *
 * Two different sources, and they are not interchangeable. Premiere's scripting
 * API cannot read audio levels at all, so presence is checked from the timeline
 * and loudness is measured on the exported file with ffmpeg. When there is no
 * export, the level check is SKIPPED rather than guessed at.
 *
 * This is a sanity check, not loudness mastering. It flags silence and clipping;
 * it does not claim to measure LUFS.
 */

import type { QaCheck, QaIssue } from '../types.js';

/** Below this mean level the output is effectively silent. */
export const SILENCE_MEAN_DB = -60;
/** At or above this peak, the output is clipping. */
export const CLIPPING_MAX_DB = -0.1;
/** A mean this low usually means a gain mistake rather than a quiet mix. */
export const QUIET_MEAN_DB = -40;

export const audioPresenceCheck: QaCheck = {
  id: 'audio_presence',
  title: 'Audio',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.tracks) {
      return { status: 'ERROR', issues: [], error: 'Could not read timeline tracks from Premiere.' };
    }

    const tracksWithClips = context.tracks.audioTracks.filter((track) => track.clips.length > 0);
    const totalClips = tracksWithClips.reduce((total, track) => total + track.clips.length, 0);

    if (tracksWithClips.length === 0) {
      return {
        status: 'FAIL',
        detail: 'no audio clips',
        issues: [
          {
            code: 'audio_missing',
            message:
              'No audio clips on any audio track. Video placement does not carry linked audio automatically — check whether audio was placed at all.',
            autoFixable: false
          }
        ]
      };
    }

    const issues: QaIssue[] = [];
    for (const track of tracksWithClips) {
      for (const clip of track.clips) {
        if (clip.duration <= 0) {
          issues.push({
            code: 'audio_zero_duration',
            message: `Audio clip "${clip.name}" on A${track.index + 1} has zero duration`,
            timeSeconds: clip.startTime,
            autoFixable: false,
            data: { clipId: clip.id, trackIndex: track.index }
          });
        }
      }
    }

    const detail = `${totalClips} clip${totalClips === 1 ? '' : 's'} on ${tracksWithClips.length} track${tracksWithClips.length === 1 ? '' : 's'}`;
    if (issues.length > 0) return { status: 'FAIL', detail, issues };
    return { status: 'PASS', detail, issues: [] };
  }
};

export const exportAudioLevelsCheck: QaCheck = {
  id: 'export_audio_levels',
  title: 'Export Audio Levels',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.exportPath) {
      return {
        status: 'SKIPPED',
        detail: 'no export supplied',
        issues: []
      };
    }
    if (!context.media.exists(context.exportPath)) {
      return { status: 'ERROR', issues: [], error: `Export file not found: ${context.exportPath}` };
    }

    const levels = await context.media.measureAudio(context.exportPath);
    if (!levels) {
      return { status: 'ERROR', issues: [], error: 'Could not measure audio levels with ffmpeg.' };
    }

    const detail = `mean ${levels.meanDb.toFixed(1)}dB, peak ${levels.maxDb.toFixed(1)}dB`;
    const issues: QaIssue[] = [];

    if (levels.meanDb <= SILENCE_MEAN_DB) {
      issues.push({
        code: 'audio_silent',
        message: `Exported audio is effectively silent (mean ${levels.meanDb.toFixed(1)}dBFS).`,
        autoFixable: false,
        data: levels as unknown as Record<string, unknown>
      });
    } else if (levels.meanDb <= QUIET_MEAN_DB) {
      issues.push({
        code: 'audio_very_quiet',
        message: `Exported audio is very quiet (mean ${levels.meanDb.toFixed(1)}dBFS) — check for a gain mistake.`,
        autoFixable: false,
        data: levels as unknown as Record<string, unknown>
      });
    }

    if (levels.maxDb >= CLIPPING_MAX_DB) {
      issues.push({
        code: 'audio_clipping',
        message: `Exported audio peaks at ${levels.maxDb.toFixed(1)}dBFS — clipping.`,
        autoFixable: false,
        data: levels as unknown as Record<string, unknown>
      });
    }

    if (issues.length === 0) return { status: 'PASS', detail, issues: [] };
    // Gain decisions are editorial and this is a sanity check, not mastering.
    return { status: 'REVIEW', detail, issues };
  }
};
