/**
 * Automated QA types.
 *
 * The governing rule: a successful tool call is not evidence. Every check here
 * reads back actual project state, inspects the exported file, or reports that
 * it could not verify. There is no status meaning "probably fine".
 */

/** Outcome of a single check. ERROR is never folded into PASS. */
export type QaStatus = 'PASS' | 'FAIL' | 'AUTO_FIX' | 'REVIEW' | 'SKIPPED' | 'ERROR';

/**
 * How much the repository actually trusts a check.
 *
 * VERIFIED      the underlying API or tool is known to return real data
 * EXPERIMENTAL  implemented, but the underlying surface is documented unreliable
 * UNAVAILABLE   no API exists; the check reports SKIPPED and says why
 */
export type QaSupportLevel = 'VERIFIED' | 'EXPERIMENTAL' | 'UNAVAILABLE';

/**
 * Overall verdict. Deliberately excludes anything meaning "perfect" — technical
 * QA passing is not editorial approval.
 */
export type QaFinalStatus = 'READY_FOR_REVIEW' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'FAILED';

export type QaLayer = 'technical' | 'visual';

/** A single problem found by a check. */
export interface QaIssue {
  /** Short machine-readable code, e.g. "timeline_gap". */
  code: string;
  /** One line a human can act on. */
  message: string;
  /** Where in the timeline or file, when known. */
  location?: string | undefined;
  /** Seconds into the sequence, when known. */
  timeSeconds?: number | undefined;
  /** Whether an auto-fix exists and is considered safe for this exact issue. */
  autoFixable: boolean;
  /** Identifier of the fix that claims this issue. */
  fixId?: string | undefined;
  /** Anything the fix needs to do its work. */
  data?: Record<string, unknown> | undefined;
}

export interface QaCheckResult {
  checkId: string;
  title: string;
  layer: QaLayer;
  status: QaStatus;
  support: QaSupportLevel;
  /** Short value shown beside the status, e.g. "1080x1920" or "0 detected". */
  detail?: string | undefined;
  issues: QaIssue[];
  durationMs: number;
  /** Set when status is ERROR. */
  error?: string | undefined;
  /** True once this result came from a re-run after an auto-fix. */
  rerun?: boolean | undefined;
}

export interface QaFixAttempt {
  fixId: string;
  checkId: string;
  issueCode: string;
  description: string;
  /** State captured before mutating, so the change is explainable and reversible. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  applied: boolean;
  /** Result of re-running the originating check afterwards. */
  verified: boolean;
  verificationStatus: QaStatus | null;
  error?: string | undefined;
  attempt: number;
}

export interface QaScore {
  requiredExecuted: number;
  requiredPassed: number;
  percent: number;
}

export interface QaReport {
  projectName: string;
  workflow: string;
  sequenceId: string | null;
  startedAt: string;
  durationMs: number;
  technical: QaCheckResult[];
  visual: QaCheckResult[];
  fixes: QaFixAttempt[];
  firstPassScore: QaScore;
  finalScore: QaScore;
  reviewItems: QaIssue[];
  blockingItems: QaIssue[];
  finalStatus: QaFinalStatus;
  /** Checks that could not run because no API exists. */
  unavailable: string[];
  autoFixEnabled: boolean;
  visualQaEnabled: boolean;
}

/** Per-workflow QA configuration. */
export interface QaWorkflowConfig {
  workflow: string;
  /** Checks that must pass for the workflow to leave BLOCKED. */
  requiredChecks: string[];
  /** Checks run for information; failures become REVIEW rather than blocking. */
  optionalChecks: string[];
  visualQa: boolean;
  autoFix: boolean;
  expectedWidth: number;
  expectedHeight: number;
  /** Frames per second as a rational, e.g. 30000/1001 for 29.97. */
  expectedFps: { numerator: number; denominator: number };
  /** Seconds; when set, timeline duration is checked against it. */
  expectedDurationSeconds?: number | undefined;
  durationToleranceSeconds: number;
  /** Video track index the logo must sit on. */
  logoTrackIndex: number;
  /** Substring identifying the logo clip by name. */
  logoAssetPattern: string;
  /**
   * Logo placements signed off as the house standard, even where they cross a
   * safe-zone line. A logo sitting on one (within LOGO_PLACEMENT_TOLERANCE) passes
   * and is never nudged.
   */
  approvedLogoPlacements?: ApprovedLogoPlacement[];
  /** Substring identifying the end-card clip by name. */
  endCardPattern: string;
  endCardDurationSeconds: number;
  endCardDurationToleranceSeconds: number;
  /** Names (substrings) of graphics the workflow requires on the timeline. */
  requiredGraphics: string[];
  /** Positions through the sequence at which visual QA samples frames, 0..1. */
  visualSamplePoints: number[];
}

export interface QaRunOptions {
  sequenceId?: string | undefined;
  workflow?: string | undefined;
  projectName?: string | undefined;
  /** Absolute path to the exported file, enabling the export-side checks. */
  exportPath?: string | undefined;
  autoFix?: boolean | undefined;
  visualQa?: boolean | undefined;
  /** Overrides merged over the workflow profile. */
  config?: Partial<QaWorkflowConfig> | undefined;
  /** Directory for extracted QA frames. Defaults to a temp directory. */
  frameOutputDir?: string | undefined;
  /** Hard cap on auto-fix attempts per issue. */
  maxFixAttempts?: number | undefined;
}

/** What a check needs to do its job. */
export interface QaContext {
  config: QaWorkflowConfig;
  sequenceId: string | null;
  exportPath: string | null;
  frameOutputDir: string;
  /** Reads Premiere state. Faked in tests. */
  premiere: PremiereReader;
  /** Reads media files. Faked in tests. */
  media: MediaProbe;
  /** Sequence settings, resolved once and shared between checks. */
  sequence: SequenceInfo | null;
  /** Timeline tracks, resolved once and shared between checks. */
  tracks: TimelineTracks | null;
}

export interface SequenceInfo {
  name: string;
  sequenceId: string;
  width: number;
  height: number;
  /** Premiere ticks per frame. fps = 254016000000 / timebase. */
  timebase: number;
  fps: number;
}

export interface TimelineClip {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface TimelineTrack {
  index: number;
  name: string;
  clips: TimelineClip[];
  clipCount: number;
}

export interface TimelineTracks {
  videoTracks: TimelineTrack[];
  audioTracks: TimelineTrack[];
}

/**
 * The seam between QA and Premiere. Every Premiere-dependent check goes through
 * this interface, which is what makes them testable without Premiere running.
 */
export interface PremiereReader {
  getSequenceSettings(sequenceId: string): Promise<SequenceInfo | null>;
  listSequenceTracks(sequenceId: string): Promise<TimelineTracks | null>;
  getActiveSequenceId(): Promise<string | null>;
  getProjectName(): Promise<string | null>;
  /** Reads a clip parameter without mutating it. */
  getParamValue(clipId: string, componentName: string, paramName: string): Promise<number | number[] | null>;
  /** Writes a clip parameter. Used only by auto-fixes. */
  setParamValue(
    clipId: string,
    componentName: string,
    paramName: string,
    value: number | number[]
  ): Promise<{ success: boolean; actual?: number | number[]; error?: string }>;
  /** Premiere-side frame export. Documented unreliable at arbitrary times. */
  exportFrame(sequenceId: string, timeSeconds: number, outputPath: string): Promise<boolean>;
  /**
   * Moves a clip, and by default every track item linked to it, to a new
   * timeline position. Used only by the gap auto-fix. Moving the video alone
   * slips the linked audio out of sync, which is why linked items travel too.
   */
  moveClip(clipId: string, newTimeSeconds: number, options?: MoveClipOptions): Promise<MoveClipResult>;
  /**
   * Lengthens a clip's tail by whole frames, trimming its out point and timeline
   * end together, with linked items by default. `dryRun` writes nothing and only
   * reports each item's source, which is how the gap fix proves a handle exists.
   */
  extendClipTail(clipId: string, frames: number, options?: ExtendClipTailOptions): Promise<ExtendClipTailResult>;
}

export interface ExtendClipTailOptions {
  sequenceId?: string;
  /** Extend linked track items (the clip's audio) too. Default true. */
  includeLinked?: boolean;
  /** Report sources without writing. */
  dryRun?: boolean;
  /** Refuse if a new out point would pass these, per track type, in source seconds. */
  maxOutPointSeconds?: { video?: number; audio?: number };
}

/** One track item as extend_clip_tail saw it. Times in seconds. */
export interface ClipTailItem {
  clipId: string;
  name: string;
  trackType: 'video' | 'audio';
  trackIndex: number;
  mediaPath: string;
  /** Stills are never extended: writing `end` on one hangs ExtendScript. */
  isStill: boolean;
  inPoint: number;
  outPoint: number;
  startTime: number;
  endTime: number;
}

export interface ExtendClipTailResult {
  success: boolean;
  error?: string;
  /** Items before the write (or, on a dry run, as they are). Target clip first. */
  items?: ClipTailItem[];
  /** Items after the write, read back. Absent on a dry run or failure. */
  after?: ClipTailItem[];
}

export interface MoveClipOptions {
  /** Scopes the clip lookup to one sequence. */
  sequenceId?: string;
  /** Move linked track items (e.g. the clip's audio) by the same amount. Default true. */
  includeLinked?: boolean;
}

/** One track item a move touched, with where it sat before and after. */
export interface MovedTrackItem {
  clipId: string;
  name: string;
  trackType: 'video' | 'audio';
  trackIndex: number;
  oldTime: number;
  newTime: number;
}

export interface MoveClipResult {
  success: boolean;
  error?: string;
  /** Applied shift in seconds, snapped to the sequence frame grid. */
  shiftSeconds?: number;
  /** Every item moved, the target clip first. Absent when nothing moved. */
  moved?: MovedTrackItem[];
}

export interface MediaStreamInfo {
  width: number | null;
  height: number | null;
  /** Container duration. Can overrun the video: AAC padding made a 5.972s clip read 6.000s. */
  durationSeconds: number | null;
  /** Per-stream durations, for anything that must not read past the last real frame. */
  videoDurationSeconds?: number | null;
  audioDurationSeconds?: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  frameRate: number | null;
  sizeBytes: number;
}

/** File-level inspection. Backed by ffprobe/ffmpeg in production. */
export interface MediaProbe {
  exists(filePath: string): boolean;
  sizeBytes(filePath: string): number;
  probe(filePath: string): Promise<MediaStreamInfo | null>;
  /** Intervals of near-black video, from ffmpeg blackdetect. */
  detectBlackFrames(
    filePath: string,
    minDurationSeconds: number
  ): Promise<Array<{ start: number; end: number; duration: number }>>;
  /** Mean and peak volume in dBFS. */
  measureAudio(filePath: string): Promise<{ meanDb: number; maxDb: number } | null>;
  /** Extracts a still at a timestamp. Returns the path written, or null. */
  extractFrame(filePath: string, timeSeconds: number, outputPath: string): Promise<string | null>;
  /** Mean luma of a still, 0-255. Used to screen frames that are simply black. */
  meanLuma(imagePath: string): Promise<number | null>;
}

/** A registered check. */
export interface QaCheck {
  id: string;
  title: string;
  layer: QaLayer;
  support: QaSupportLevel;
  /** Why the check is unavailable, when it is. */
  unavailableReason?: string | undefined;
  run(context: QaContext): Promise<Omit<QaCheckResult, 'checkId' | 'title' | 'layer' | 'support' | 'durationMs'>>;
}

/** A registered auto-fix. */
export interface QaFix {
  id: string;
  /** Issue codes this fix claims. */
  handles: string[];
  describe(issue: QaIssue): string;
  apply(
    issue: QaIssue,
    context: QaContext
  ): Promise<{
    applied: boolean;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    error?: string | undefined;
  }>;
}

export const PREMIERE_TICKS_PER_SECOND = 254016000000;

export interface ApprovedLogoPlacement {
  frameWidth: number;
  frameHeight: number;
  /** Normalised Motion > Position. */
  position: [number, number];
  /** Motion > Scale, percent. */
  scale: number;
  label: string;
  /** Who approved it and when, for the report. */
  approved: string;
}
