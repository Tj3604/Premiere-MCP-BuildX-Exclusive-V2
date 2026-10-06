/**
 * Session lifecycle, stage timing, human activity and aggregation.
 *
 * A session is one production workflow. Its three headline numbers are computed,
 * never assumed:
 *
 *   total elapsed        wall clock, start to finish
 *   automated processing merged spans of machine-run operations
 *   human active         merged spans of explicit human involvement
 *
 * Spans are merged rather than summed so two operations running at once cannot
 * inflate a total past the wall clock.
 */

import type { TelemetryDatabase } from './database.js';
import {
  HUMAN_CATEGORIES,
  type QaRunRecord,
  type HumanActivityKind,
  type SessionRecord,
  type SessionStatus,
  type StageBreakdown,
  type StartSessionInput,
  type WorkflowStage
} from './types.js';

export type Clock = () => number;

interface Interval {
  start: number;
  end: number;
}

/**
 * Total time covered by a set of intervals, counting overlap once.
 */
export function mergeIntervalDuration(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return 0;

  let total = 0;
  const first = sorted[0] as Interval;
  let currentStart = first.start;
  let currentEnd = first.end;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i] as Interval;
    if (next.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, next.end);
    } else {
      total += currentEnd - currentStart;
      currentStart = next.start;
      currentEnd = next.end;
    }
  }
  return total + (currentEnd - currentStart);
}

/** ISO 8601 timestamp carrying the machine's local UTC offset. */
export function toLocalIso(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset =
    offsetMinutes === 0
      ? 'Z'
      : `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  );
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return num(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);
}

function nullableStr(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Maps a raw sessions row into a SessionRecord. */
export function rowToSession(row: Record<string, unknown>): SessionRecord {
  return {
    sessionId: str(row.session_id),
    projectName: str(row.project_name),
    workflowType: str(row.workflow_type),
    startedAt: str(row.started_at),
    completedAt: nullableStr(row.completed_at),
    startedMs: num(row.started_ms),
    completedMs: nullableNum(row.completed_ms),
    totalElapsedMs: num(row.total_elapsed_ms),
    automatedProcessingMs: num(row.automated_processing_ms),
    humanActiveMs: num(row.human_active_ms),
    toolCalls: num(row.tool_calls),
    successfulCalls: num(row.successful_calls),
    failedCalls: num(row.failed_calls),
    timeoutFailures: num(row.timeout_failures),
    retries: num(row.retries),
    guiFallbacks: num(row.gui_fallbacks),
    manualCorrections: num(row.manual_corrections),
    qaChecks: num(row.qa_checks),
    qaFailures: num(row.qa_failures),
    baselineHumanMinutes: nullableNum(row.baseline_human_minutes),
    finalStatus: str(row.final_status, 'in_progress') as SessionStatus,
    notes: nullableStr(row.notes)
  };
}

/** Counter columns that instrumentation increments. */
export type CounterField =
  | 'tool_calls'
  | 'successful_calls'
  | 'failed_calls'
  | 'timeout_failures'
  | 'retries'
  | 'gui_fallbacks'
  | 'manual_corrections'
  | 'qa_checks'
  | 'qa_failures';

const COUNTER_FIELDS: ReadonlySet<string> = new Set<CounterField>([
  'tool_calls',
  'successful_calls',
  'failed_calls',
  'timeout_failures',
  'retries',
  'gui_fallbacks',
  'manual_corrections',
  'qa_checks',
  'qa_failures'
]);

export class SessionManager {
  constructor(
    private readonly db: TelemetryDatabase,
    private readonly now: Clock = () => Date.now()
  ) {}

  /** buildx_<date>_<NNN>, the NNN counting that day's sessions. */
  generateSessionId(atMs = this.now()): string {
    const date = toLocalIso(atMs).slice(0, 10);
    const prefix = `buildx_${date}_`;
    const rows = this.db.query<{ session_id: unknown }>(
      'SELECT session_id FROM sessions WHERE session_id LIKE ?',
      [`${prefix}%`]
    );
    let highest = 0;
    for (const row of rows) {
      const suffix = str(row.session_id).slice(prefix.length);
      const parsed = Number.parseInt(suffix, 10);
      if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
    }
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  }

  startSession(input: StartSessionInput): SessionRecord {
    const startedMs = this.now();
    const sessionId = input.sessionId ?? this.generateSessionId(startedMs);
    this.db.run(
      `INSERT OR REPLACE INTO sessions
        (session_id, project_name, workflow_type, started_at, started_ms,
         baseline_human_minutes, final_status, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)`,
      [
        sessionId,
        input.projectName,
        input.workflowType,
        toLocalIso(startedMs),
        startedMs,
        input.baselineHumanMinutes ?? null,
        input.notes ?? null
      ]
    );
    const record = this.getSession(sessionId);
    if (record) return record;
    // Store unavailable: hand back an in-memory record so callers still get an id.
    return {
      sessionId,
      projectName: input.projectName,
      workflowType: input.workflowType,
      startedAt: toLocalIso(startedMs),
      completedAt: null,
      startedMs,
      completedMs: null,
      totalElapsedMs: 0,
      automatedProcessingMs: 0,
      humanActiveMs: 0,
      toolCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timeoutFailures: 0,
      retries: 0,
      guiFallbacks: 0,
      manualCorrections: 0,
      qaChecks: 0,
      qaFailures: 0,
      baselineHumanMinutes: input.baselineHumanMinutes ?? null,
      finalStatus: 'in_progress',
      notes: input.notes ?? null
    };
  }

  /** Renames an unattributed auto-session in place instead of orphaning it. */
  relabelSession(sessionId: string, input: StartSessionInput): void {
    this.db.run(
      `UPDATE sessions SET project_name = ?, workflow_type = ?,
        baseline_human_minutes = COALESCE(?, baseline_human_minutes),
        notes = COALESCE(?, notes)
       WHERE session_id = ?`,
      [
        input.projectName,
        input.workflowType,
        input.baselineHumanMinutes ?? null,
        input.notes ?? null,
        sessionId
      ]
    );
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM sessions WHERE session_id = ?',
      [sessionId]
    );
    return row ? rowToSession(row) : null;
  }

  getLastSession(): SessionRecord | null {
    const row = this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM sessions ORDER BY started_ms DESC LIMIT 1'
    );
    return row ? rowToSession(row) : null;
  }

  getRecentSessions(limit: number): SessionRecord[] {
    return this.db
      .query<Record<string, unknown>>('SELECT * FROM sessions ORDER BY started_ms DESC LIMIT ?', [
        Math.max(1, Math.floor(limit))
      ])
      .map(rowToSession);
  }

  /** month is YYYY-MM, matched against the session's local start date. */
  getSessionsForMonth(month: string): SessionRecord[] {
    return this.db
      .query<Record<string, unknown>>(
        'SELECT * FROM sessions WHERE substr(started_at, 1, 7) = ? ORDER BY started_ms ASC',
        [month]
      )
      .map(rowToSession);
  }

  incrementCounter(sessionId: string, field: CounterField, delta = 1): void {
    if (!COUNTER_FIELDS.has(field)) return;
    // field is validated against a fixed allow-list above, never interpolated raw.
    this.db.enqueue(
      `UPDATE sessions SET ${field} = ${field} + ? WHERE session_id = ?`,
      [delta, sessionId]
    );
  }

  setBaseline(sessionId: string, baselineHumanMinutes: number | null): void {
    this.db.run('UPDATE sessions SET baseline_human_minutes = ? WHERE session_id = ?', [
      baselineHumanMinutes,
      sessionId
    ]);
  }

  // ---- stages ----

  startStage(sessionId: string, stage: WorkflowStage): void {
    const startedMs = this.now();
    // Close any same-named stage left open, so a repeated start cannot leak.
    this.endStage(sessionId, stage);
    this.db.run(
      'INSERT INTO stages (session_id, stage, started_ms) VALUES (?, ?, ?)',
      [sessionId, stage, startedMs]
    );
  }

  endStage(sessionId: string, stage: WorkflowStage): number | null {
    const endedMs = this.now();
    const row = this.db.queryOne<{ id: unknown; started_ms: unknown }>(
      'SELECT id, started_ms FROM stages WHERE session_id = ? AND stage = ? AND ended_ms IS NULL ORDER BY id DESC LIMIT 1',
      [sessionId, stage]
    );
    if (!row) return null;
    const duration = Math.max(0, endedMs - num(row.started_ms));
    this.db.run('UPDATE stages SET ended_ms = ?, duration_ms = ? WHERE id = ?', [
      endedMs,
      duration,
      num(row.id)
    ]);
    return duration;
  }

  getStageBreakdown(sessionId: string): StageBreakdown[] {
    return this.db
      .query<{ stage: unknown; total: unknown }>(
        `SELECT stage, SUM(COALESCE(duration_ms, 0)) AS total
         FROM stages WHERE session_id = ? GROUP BY stage`,
        [sessionId]
      )
      .map((row) => ({ stage: str(row.stage), durationMs: num(row.total) }));
  }

  // ---- human activity ----

  startHumanActivity(sessionId: string, kind: HumanActivityKind, reason?: string): void {
    const startedMs = this.now();
    this.db.run(
      'INSERT INTO human_activity (session_id, kind, reason, started_ms) VALUES (?, ?, ?, ?)',
      [sessionId, kind, reason ?? null, startedMs]
    );
  }

  stopHumanActivity(sessionId: string, kind: HumanActivityKind): number | null {
    const endedMs = this.now();
    const row = this.db.queryOne<{ id: unknown; started_ms: unknown }>(
      'SELECT id, started_ms FROM human_activity WHERE session_id = ? AND kind = ? AND ended_ms IS NULL ORDER BY id DESC LIMIT 1',
      [sessionId, kind]
    );
    if (!row) return null;
    const duration = Math.max(0, endedMs - num(row.started_ms));
    this.db.run('UPDATE human_activity SET ended_ms = ?, duration_ms = ? WHERE id = ?', [
      endedMs,
      duration,
      num(row.id)
    ]);
    return duration;
  }

  /**
   * A correction is a point event with an optional duration. It counts toward
   * human active time only when a duration is supplied.
   */
  recordManualCorrection(sessionId: string, reason?: string, durationMs = 0): void {
    const atMs = this.now();
    this.db.run(
      'INSERT INTO human_activity (session_id, kind, reason, started_ms, ended_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, 'correction', reason ?? null, atMs, atMs + durationMs, durationMs]
    );
    this.incrementCounter(sessionId, 'manual_corrections');
  }

  recordQaCheck(sessionId: string, passed: boolean, name?: string, detail?: string): void {
    this.db.enqueue(
      'INSERT INTO qa_checks (session_id, name, passed, detail, recorded_ms) VALUES (?, ?, ?, ?, ?)',
      [sessionId, name ?? null, passed ? 1 : 0, detail ?? null, this.now()]
    );
    this.incrementCounter(sessionId, 'qa_checks');
    if (!passed) this.incrementCounter(sessionId, 'qa_failures');
  }

  /**
   * Records one QA pass. The per-check counters already on the session
   * (qa_checks / qa_failures) keep counting individual verifications; these
   * columns describe the automated pass as a whole.
   */
  recordQaRun(sessionId: string, run: QaRunRecord): void {
    this.db.run(
      `INSERT INTO qa_runs
        (session_id, project_name, workflow, sequence_id, ran_at_ms, duration_ms,
         checks_executed, checks_passed, checks_failed, checks_errored, checks_review, checks_skipped,
         auto_fixes_attempted, auto_fixes_successful, auto_fixes_failed,
         first_pass_passed, first_pass_executed, first_pass_percent,
         final_passed, final_executed, final_percent, final_status, failed_check_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        run.projectName,
        run.workflow,
        run.sequenceId,
        this.now(),
        run.durationMs,
        run.checksExecuted,
        run.checksPassed,
        run.checksFailed,
        run.checksErrored,
        run.checksReview,
        run.checksSkipped,
        run.autoFixesAttempted,
        run.autoFixesSuccessful,
        run.autoFixesFailed,
        run.firstPassPassed,
        run.firstPassExecuted,
        run.firstPassPercent,
        run.finalPassed,
        run.finalExecuted,
        run.finalPercent,
        run.finalStatus,
        JSON.stringify(run.failedCheckIds)
      ]
    );

    this.db.run(
      `UPDATE sessions SET
         qa_runs_count = qa_runs_count + 1,
         qa_checks = qa_checks + ?,
         qa_failures = qa_failures + ?,
         qa_reviews = qa_reviews + ?,
         qa_errors = qa_errors + ?,
         qa_auto_fix_attempts = qa_auto_fix_attempts + ?,
         qa_auto_fix_successes = qa_auto_fix_successes + ?,
         qa_auto_fix_failures = qa_auto_fix_failures + ?,
         qa_duration_ms = qa_duration_ms + ?,
         qa_first_pass_percent = ?,
         qa_final_percent = ?,
         qa_final_status = ?
       WHERE session_id = ?`,
      [
        run.checksExecuted,
        run.checksFailed,
        run.checksReview,
        run.checksErrored,
        run.autoFixesAttempted,
        run.autoFixesSuccessful,
        run.autoFixesFailed,
        run.durationMs,
        run.firstPassPercent,
        run.finalPercent,
        run.finalStatus,
        sessionId
      ]
    );
  }

  getQaRuns(sessionId: string): Array<Record<string, unknown>> {
    return this.db.query<Record<string, unknown>>(
      'SELECT * FROM qa_runs WHERE session_id = ? ORDER BY id DESC',
      [sessionId]
    );
  }

  // ---- aggregation ----

  /**
   * Recomputes the three headline durations from the recorded spans and writes
   * them back onto the session row.
   */
  recomputeAggregates(sessionId: string, atMs = this.now()): SessionRecord | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const endMs = session.completedMs ?? atMs;

    const operations = this.db.query<{ category: unknown; started_ms: unknown; ended_ms: unknown }>(
      'SELECT category, started_ms, ended_ms FROM operations WHERE session_id = ? AND ended_ms IS NOT NULL',
      [sessionId]
    );

    const automated: Interval[] = [];
    const human: Interval[] = [];
    for (const op of operations) {
      const interval = { start: num(op.started_ms), end: num(op.ended_ms) };
      if (HUMAN_CATEGORIES.has(str(op.category))) human.push(interval);
      else automated.push(interval);
    }

    const humanSpans = this.db.query<{ started_ms: unknown; ended_ms: unknown }>(
      'SELECT started_ms, ended_ms FROM human_activity WHERE session_id = ? AND ended_ms IS NOT NULL',
      [sessionId]
    );
    for (const span of humanSpans) {
      human.push({ start: num(span.started_ms), end: num(span.ended_ms) });
    }

    const automatedProcessingMs = mergeIntervalDuration(automated);
    const humanActiveMs = mergeIntervalDuration(human);

    // recordOperation back-dates work that ran outside this process (a shell
    // transcription, say), so a span can start before the session row was
    // written. The elapsed window is widened to cover every recorded span
    // rather than reporting a total that is smaller than its own parts.
    const spans = [...automated, ...human];
    const earliest = spans.reduce((min, span) => Math.min(min, span.start), session.startedMs);
    const latest = spans.reduce((max, span) => Math.max(max, span.end), endMs);
    const totalElapsedMs = Math.max(0, latest - earliest);

    this.db.run(
      'UPDATE sessions SET total_elapsed_ms = ?, automated_processing_ms = ?, human_active_ms = ? WHERE session_id = ?',
      [totalElapsedMs, automatedProcessingMs, humanActiveMs, sessionId]
    );

    return {
      ...session,
      totalElapsedMs,
      automatedProcessingMs,
      humanActiveMs
    };
  }

  endSession(sessionId: string, status: SessionStatus = 'success'): SessionRecord | null {
    const completedMs = this.now();
    const existing = this.getSession(sessionId);
    if (!existing) return null;

    // Close anything the workflow left hanging so no span is silently dropped.
    for (const row of this.db.query<{ stage: unknown }>(
      'SELECT DISTINCT stage FROM stages WHERE session_id = ? AND ended_ms IS NULL',
      [sessionId]
    )) {
      this.endStage(sessionId, str(row.stage));
    }
    for (const row of this.db.query<{ kind: unknown }>(
      'SELECT DISTINCT kind FROM human_activity WHERE session_id = ? AND ended_ms IS NULL',
      [sessionId]
    )) {
      this.stopHumanActivity(sessionId, str(row.kind) as HumanActivityKind);
    }

    this.db.run(
      'UPDATE sessions SET completed_at = ?, completed_ms = ?, final_status = ? WHERE session_id = ?',
      [toLocalIso(completedMs), completedMs, status, sessionId]
    );
    return this.recomputeAggregates(sessionId, completedMs);
  }
}
