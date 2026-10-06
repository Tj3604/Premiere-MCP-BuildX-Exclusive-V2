/**
 * Visual QA.
 *
 * What this layer honestly does: it extracts representative frames and screens
 * them for the one thing a machine can decide on its own — whether a frame is
 * simply black. Everything else on the visual list (a lower third covering a
 * face, a badly framed crop, a malformed graphic) is a judgement, and judgements
 * are returned as REVIEW with the frame path attached, for a human or a
 * multimodal agent to look at. This layer never makes an editorial change.
 *
 * Frames come from the EXPORTED FILE via ffmpeg wherever one exists. Premiere's
 * own export_frame is used only as a fallback, and the check is downgraded to
 * EXPERIMENTAL when it is: export_frame is documented reliable for confirming a
 * static overlay but unreliable at arbitrary times on a long sequence, having
 * returned stale frames on two of three probes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { formatTimecode } from '../frames.js';
import type { QaCheck, QaContext, QaIssue } from '../types.js';
import { timelineDurationSeconds } from './timeline.js';

/**
 * Below this mean luma a sampled frame is treated as black.
 *
 * Measured, not guessed. H.264 in yuv420p is limited-range, so true black encodes
 * as luma 16 rather than 0 — a threshold near zero can never fire on a real
 * export. Measured on this machine: a fully black frame reads 16, a genuinely
 * dark shot (#0A0A0A) reads 25, ordinary content reads ~126. 20 sits between
 * black and dark, which is exactly where the line belongs.
 */
export const BLACK_FRAME_LUMA = 20;

export interface SampledFrame {
  label: string;
  fraction: number;
  timeSeconds: number;
  imagePath: string | null;
  meanLuma: number | null;
  source: 'export' | 'premiere' | 'none';
}

function labelFor(fraction: number): string {
  if (fraction <= 0) return 'Opening Frame';
  if (fraction >= 1) return 'End Frame';
  return `${Math.round(fraction * 100)}% Frame`;
}

/** Extracts one still per sample point. Never throws. */
export async function sampleFrames(context: QaContext, durationSeconds: number): Promise<SampledFrame[]> {
  const frames: SampledFrame[] = [];
  try {
    fs.mkdirSync(context.frameOutputDir, { recursive: true });
  } catch {
    return frames;
  }

  for (const fraction of context.config.visualSamplePoints) {
    const clamped = Math.min(Math.max(fraction, 0), 1);
    // Step just inside the ends so the last frame is not sampled past EOF.
    const timeSeconds =
      clamped >= 1 ? Math.max(0, durationSeconds - 0.1) : clamped <= 0 ? 0.02 : durationSeconds * clamped;
    const outputPath = path.join(
      context.frameOutputDir,
      `qa-${String(Math.round(clamped * 100)).padStart(3, '0')}.png`
    );

    let imagePath: string | null = null;
    let source: SampledFrame['source'] = 'none';

    if (context.exportPath && context.media.exists(context.exportPath)) {
      imagePath = await context.media.extractFrame(context.exportPath, timeSeconds, outputPath);
      if (imagePath) source = 'export';
    } else if (context.sequenceId) {
      // export_frame appends its own extension, so the base name is passed bare.
      const base = outputPath.replace(/\.png$/, '');
      const ok = await context.premiere.exportFrame(context.sequenceId, timeSeconds, base);
      if (ok && context.media.exists(`${base}.png`)) {
        imagePath = `${base}.png`;
        source = 'premiere';
      }
    }

    frames.push({
      label: labelFor(clamped),
      fraction: clamped,
      timeSeconds,
      imagePath,
      meanLuma: imagePath ? await context.media.meanLuma(imagePath) : null,
      source
    });
  }

  return frames;
}

export const visualFramesCheck: QaCheck = {
  id: 'visual_frames',
  title: 'Visual Frames',
  layer: 'visual',
  support: 'EXPERIMENTAL',
  unavailableReason:
    'Objective black-frame screening is reliable. Subjective findings (framing, overlap, legibility) are returned as REVIEW with frame paths — they are not machine-decidable.',
  async run(context) {
    const durationSeconds = context.tracks
      ? timelineDurationSeconds(context.tracks)
      : ((await context.media.probe(context.exportPath ?? ''))?.durationSeconds ?? 0);

    if (durationSeconds <= 0) {
      return { status: 'SKIPPED', detail: 'no duration to sample', issues: [] };
    }
    if (!context.exportPath && !context.sequenceId) {
      return { status: 'SKIPPED', detail: 'nothing to sample from', issues: [] };
    }

    const frames = await sampleFrames(context, durationSeconds);
    const captured = frames.filter((frame) => frame.imagePath !== null);
    if (captured.length === 0) {
      return {
        status: 'ERROR',
        issues: [],
        error: 'Could not extract any frames for visual QA.'
      };
    }

    const fps = context.sequence?.fps ?? 30;
    const issues: QaIssue[] = [];

    for (const frame of captured) {
      if (frame.meanLuma !== null && frame.meanLuma <= BLACK_FRAME_LUMA && frame.fraction < 1) {
        // Objective, so this one is a FAIL rather than a REVIEW.
        issues.push({
          code: 'visual_black_frame',
          message: `${frame.label} at ${formatTimecode(frame.timeSeconds, fps)} is black (mean luma ${frame.meanLuma.toFixed(1)}).`,
          timeSeconds: frame.timeSeconds,
          location: frame.imagePath ?? undefined,
          autoFixable: false,
          data: { imagePath: frame.imagePath, meanLuma: frame.meanLuma }
        });
      }
    }

    const usedPremiereFallback = captured.some((frame) => frame.source === 'premiere');
    const detail =
      `${captured.length}/${frames.length} frames from ${usedPremiereFallback ? 'Premiere (unreliable at arbitrary times)' : 'the exported file'}`;

    if (issues.length > 0) {
      return { status: 'FAIL', detail, issues };
    }

    // Frames captured and none is black. Everything else needs eyes on it.
    return {
      status: 'REVIEW',
      detail,
      issues: [
        {
          code: 'visual_review_required',
          message:
            `${captured.length} frames extracted for human or multimodal review: ` +
            captured.map((frame) => `${frame.label} -> ${frame.imagePath}`).join('; '),
          autoFixable: false,
          data: {
            frames: captured.map((frame) => ({
              label: frame.label,
              timeSeconds: frame.timeSeconds,
              imagePath: frame.imagePath,
              meanLuma: frame.meanLuma,
              source: frame.source
            }))
          }
        }
      ]
    };
  }
};
