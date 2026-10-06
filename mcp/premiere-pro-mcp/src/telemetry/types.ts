/**
 * Telemetry types for the BuildX Premiere MCP.
 *
 * The measurement principle this file encodes: total elapsed time, automated
 * processing time and human active time are three different quantities and are
 * never derived from one another. Automated processing time is never counted as
 * human labour.
 */

/** Operation categories. Extensible: any string is accepted, these are the known set. */
export const OPERATION_CATEGORIES = [
  'transcription',
  'analysis',
  'cut_planning',
  'premiere',
  'graphics',
  'qa',
  'export',
  'gui_fallback',
  'manual',
  'other'
] as const;

export type KnownOperationCategory = (typeof OPERATION_CATEGORIES)[number];

/** Categories are extensible — unknown strings are stored verbatim. */
export type OperationCategory = KnownOperationCategory | (string & {});

/**
 * Categories that represent a human being actively involved. Everything else is
 * machine time. Used to split automated vs human active time.
 */
export const HUMAN_CATEGORIES: ReadonlySet<string> = new Set(['manual', 'gui_fallback']);

/** Workflow stages aggregated in the report, in display order. */
export const WORKFLOW_STAGES = [
  'transcription',
  'analysis',
  'cut_planning',
  'timeline_build',
  'graphics',
  'qa',
  'export'
] as const;

export type KnownWorkflowStage = (typeof WORKFLOW_STAGES)[number];
export type WorkflowStage = KnownWorkflowStage | (string & {});

export type SessionStatus =
  | 'in_progress'
  | 'success'
  | 'partial'
  | 'failed'
  | 'abandoned';

export type HumanActivityKind = 'intervention' | 'correction';

export interface TelemetryConfig {
  /** Master switch. False means nothing is recorded and every call is a no-op. */
  enabled: boolean;
  /** Absolute path to the SQLite file. */
  databasePath: string;
  /**
   * Labour cost per hour used for the capacity calculation. Never hardcoded to a
   * real salary; unset means ROI money figures are omitted from reports.
   */
  hourlyLaborCost: number | null;
  /** Currency symbol used purely for display. */
  currency: string;
  /**
   * When true, instrumented tool calls arriving with no active session open an
   * unattributed session rather than being dropped on the floor.
   */
  autoSession: boolean;
  /**
   * Pins every instrumented call in this process to one existing session id.
   * Set via BUILDX_TELEMETRY_SESSION_ID so a workflow driven as many separate
   * server processes (scripts/mcp-call.mjs spawns one per call) still reports
   * as a single session instead of a string of unattributed auto-sessions.
   * Null means the usual in-memory active-session behaviour.
   */
  sessionId: string | null;
  /** Buffered operation rows are flushed once this many are pending. */
  flushThreshold: number;
  /** Buffered rows are flushed at most this many ms after the first pending row. */
  flushIntervalMs: number;
}

export interface StartSessionInput {
  projectName: string;
  workflowType: string;
  /** Supply to resume/force an id; otherwise one is generated. */
  sessionId?: string;
  /** Traditional manual time for this workflow, for the baseline comparison. */
  baselineHumanMinutes?: number;
  notes?: string;
}

export interface SessionRecord {
  sessionId: string;
  projectName: string;
  workflowType: string;
  startedAt: string;
  completedAt: string | null;
  startedMs: number;
  completedMs: number | null;
  totalElapsedMs: number;
  automatedProcessingMs: number;
  humanActiveMs: number;
  toolCalls: number;
  successfulCalls: number;
  failedCalls: number;
  timeoutFailures: number;
  retries: number;
  guiFallbacks: number;
  manualCorrections: number;
  qaChecks: number;
  qaFailures: number;
  baselineHumanMinutes: number | null;
  finalStatus: SessionStatus;
  notes: string | null;
}

export interface OperationRecord {
  operationId: string;
  sessionId: string;
  name: string;
  category: OperationCategory;
  startedMs: number;
  endedMs: number | null;
  durationMs: number | null;
  success: boolean | null;
  retryCount: number;
  timedOut: boolean;
  guiFallback: boolean;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

export interface StageRecord {
  sessionId: string;
  stage: WorkflowStage;
  startedMs: number;
  endedMs: number | null;
  durationMs: number | null;
}

export interface HumanActivityRecord {
  sessionId: string;
  kind: HumanActivityKind;
  reason: string | null;
  startedMs: number;
  endedMs: number | null;
  durationMs: number | null;
}

export interface StartOperationInput {
  name: string;
  category: OperationCategory;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Handle returned by startOperation. Duration is computed for you — callers
 * never deal in timestamps.
 */
export interface OperationHandle {
  readonly operationId: string;
  readonly sessionId: string | null;
  success(metadata?: Record<string, unknown>): void;
  fail(error: unknown, metadata?: Record<string, unknown>): void;
  /** Marks that this operation had to fall back to driving the GUI. */
  markGuiFallback(reason?: string): void;
  /** Records that this operation is a retry of a previous failed attempt. */
  markRetry(count?: number): void;
}

export interface StageBreakdown {
  stage: WorkflowStage;
  durationMs: number;
}

export interface BaselineComparison {
  baselineHumanMs: number;
  actualHumanMs: number;
  humanMsSaved: number;
  humanTimeReductionPercent: number;
  /** Only present when hourlyLaborCost is configured. */
  estimatedLaborCapacityRecovered: number | null;
  currency: string;
}

export interface SessionReport {
  session: SessionRecord;
  stages: StageBreakdown[];
  baseline: BaselineComparison | null;
  categoryBreakdown: StageBreakdown[];
}

export interface MonthlySummary {
  month: string;
  sessions: number;
  successfulSessions: number;
  failedSessions: number;
  successRatePercent: number;
  totalHumanActiveMs: number;
  totalAutomatedProcessingMs: number;
  totalElapsedMs: number;
  averageHumanActiveMs: number;
  averageAutomatedProcessingMs: number;
  toolCalls: number;
  successfulCalls: number;
  failedCalls: number;
  toolSuccessRatePercent: number;
  retries: number;
  averageRetries: number;
  guiFallbacks: number;
  guiFallbackRatePercent: number;
  manualCorrections: number;
  averageManualCorrections: number;
  qaChecks: number;
  qaFailures: number;
  sessionsWithBaseline: number;
  baselineHumanMs: number;
  actualHumanMsForBaselined: number;
  estimatedHumanMsSaved: number;
  averageHumanTimeReductionPercent: number;
  estimatedLaborCapacityRecovered: number | null;
  currency: string;
}

/** Aggregate of one QA pass, recorded against a session. */
export interface QaRunRecord {
  sessionId: string | null;
  projectName: string;
  workflow: string;
  sequenceId: string | null;
  durationMs: number;
  checksExecuted: number;
  checksPassed: number;
  checksFailed: number;
  checksErrored: number;
  checksReview: number;
  checksSkipped: number;
  autoFixesAttempted: number;
  autoFixesSuccessful: number;
  autoFixesFailed: number;
  firstPassPassed: number;
  firstPassExecuted: number;
  firstPassPercent: number;
  finalPassed: number;
  finalExecuted: number;
  finalPercent: number;
  finalStatus: string;
  failedCheckIds: string[];
}
