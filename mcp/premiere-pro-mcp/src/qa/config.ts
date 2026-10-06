/**
 * Per-workflow QA profiles.
 *
 * Different workflows require different checks — a full podcast episode has no
 * end card requirement, a landscape YouTube cut is not 1080x1920. Nothing is
 * forced onto every workflow.
 *
 * Format expectations mirror the repository's documented standards: BuildX
 * short-form is 1080x1920 at 29.97, and camera footage arrives at 23.976, so a
 * short is a rate conform rather than a passthrough.
 */

import type { QaWorkflowConfig } from './types.js';

/** 29.97 as a rational. Never compared as a float. */
export const FPS_29_97 = { numerator: 30000, denominator: 1001 };
export const FPS_23_976 = { numerator: 24000, denominator: 1001 };
export const FPS_59_94 = { numerator: 60000, denominator: 1001 };
export const FPS_30 = { numerator: 30, denominator: 1 };
export const FPS_24 = { numerator: 24, denominator: 1 };
export const FPS_60 = { numerator: 60, denominator: 1 };

/** The logo asset's native pixel size, from knowledge/buildx/safe-zones.md. */
export const LOGO_ASSET_WIDTH = 1000;
export const LOGO_ASSET_HEIGHT = 389;

/**
 * The logo placement the repository documents as current.
 *
 * NOTE: session memory records a later upper-right variant (0.794 / 0.160 at
 * scale 31). The two disagree, so neither is hardcoded as a pass condition:
 * the objective check is safe-zone compliance, which both satisfy. Set
 * `expectedLogoPosition` in a profile only if an exact placement must be
 * enforced.
 */
export const DOCUMENTED_LOGO_POSITION: [number, number] = [0.5, 0.153];
export const DOCUMENTED_LOGO_SCALE = 40;

const VERTICAL_BASE: Omit<QaWorkflowConfig, 'workflow' | 'requiredChecks' | 'optionalChecks'> = {
  visualQa: true,
  autoFix: true,
  expectedWidth: 1080,
  expectedHeight: 1920,
  expectedFps: FPS_29_97,
  durationToleranceSeconds: 0.5,
  logoTrackIndex: 2, // V3, zero-indexed
  logoAssetPattern: 'BuildX Logo',
  endCardPattern: 'CTA',
  endCardDurationSeconds: 5,
  endCardDurationToleranceSeconds: 0.5,
  requiredGraphics: [],
  visualSamplePoints: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
};

const SHORT_REQUIRED = [
  'sequence_resolution',
  'frame_rate',
  'timeline_gaps',
  'timeline_overlaps',
  'audio_presence',
  'logo_presence',
  'logo_safe_zone',
  'end_card'
];

const SHORT_OPTIONAL = [
  'timeline_duration',
  'graphics_presence',
  'captions',
  'export_file',
  'export_black_frames',
  'export_audio_levels'
];

export const QA_WORKFLOW_PROFILES: Record<string, QaWorkflowConfig> = {
  podcast_short: {
    ...VERTICAL_BASE,
    workflow: 'podcast_short',
    requiredChecks: [...SHORT_REQUIRED],
    optionalChecks: [...SHORT_OPTIONAL]
  },
  social_vertical: {
    ...VERTICAL_BASE,
    workflow: 'social_vertical',
    requiredChecks: [...SHORT_REQUIRED],
    optionalChecks: [...SHORT_OPTIONAL]
  },
  interview_clip: {
    ...VERTICAL_BASE,
    workflow: 'interview_clip',
    requiredChecks: [...SHORT_REQUIRED],
    optionalChecks: [...SHORT_OPTIONAL]
  },
  home_tour: {
    ...VERTICAL_BASE,
    workflow: 'home_tour',
    requiredChecks: [...SHORT_REQUIRED],
    optionalChecks: [...SHORT_OPTIONAL]
  },
  // A full episode is landscape, long, and carries no end card requirement.
  podcast_full_episode: {
    ...VERTICAL_BASE,
    workflow: 'podcast_full_episode',
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedFps: FPS_29_97,
    logoTrackIndex: 2,
    endCardPattern: '',
    visualQa: false,
    requiredChecks: ['sequence_resolution', 'frame_rate', 'timeline_gaps', 'audio_presence'],
    optionalChecks: ['timeline_overlaps', 'timeline_duration', 'export_file', 'export_audio_levels']
  },
  youtube_landscape: {
    ...VERTICAL_BASE,
    workflow: 'youtube_landscape',
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedFps: FPS_29_97,
    endCardPattern: '',
    requiredChecks: ['sequence_resolution', 'frame_rate', 'timeline_gaps', 'audio_presence', 'logo_presence'],
    optionalChecks: [
      'timeline_overlaps',
      'timeline_duration',
      'logo_safe_zone',
      'export_file',
      'export_black_frames',
      'export_audio_levels'
    ]
  }
};

export const DEFAULT_WORKFLOW = 'podcast_short';

/** Resolves a profile, falling back to the default and applying any overrides. */
export function resolveWorkflowConfig(
  workflow: string | undefined,
  overrides: Partial<QaWorkflowConfig> = {}
): QaWorkflowConfig {
  const base =
    (workflow ? QA_WORKFLOW_PROFILES[workflow] : undefined) ??
    QA_WORKFLOW_PROFILES[DEFAULT_WORKFLOW];
  const resolved = base as QaWorkflowConfig;
  return {
    ...resolved,
    ...overrides,
    workflow: overrides.workflow ?? workflow ?? resolved.workflow,
    requiredChecks: overrides.requiredChecks ?? [...resolved.requiredChecks],
    optionalChecks: overrides.optionalChecks ?? [...resolved.optionalChecks],
    expectedFps: overrides.expectedFps ?? { ...resolved.expectedFps },
    visualSamplePoints: overrides.visualSamplePoints ?? [...resolved.visualSamplePoints],
    requiredGraphics: overrides.requiredGraphics ?? [...resolved.requiredGraphics]
  };
}

export function listWorkflows(): string[] {
  return Object.keys(QA_WORKFLOW_PROFILES);
}
