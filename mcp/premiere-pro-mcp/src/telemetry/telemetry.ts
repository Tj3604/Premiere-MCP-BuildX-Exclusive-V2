/**
 * The telemetry facade.
 *
 * Two rules govern everything in this file:
 *
 *  1. Telemetry is non-critical infrastructure. Every entry point is wrapped so
 *     a telemetry failure is logged and swallowed, never raised into an edit.
 *  2. Telemetry is local. Nothing is transmitted anywhere; the only sink is a
 *     SQLite file on this machine.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '../utils/logger.js';
import { TelemetryDatabase } from './database.js';
import { SessionManager, type Clock } from './session.js';
import { OperationTracker } from './operations.js';
import {
  buildMonthlySummary,
  computeBaseline,
  renderMonthlySummary,
  renderSessionList,
  renderSessionReport
} from './reports.js';
import type {
  HumanActivityKind,
  MonthlySummary,
  OperationCategory,
  OperationHandle,
  QaRunRecord,
  SessionRecord,
  SessionReport,
  SessionStatus,
  StartOperationInput,
  StartSessionInput,
  TelemetryConfig,
  WorkflowStage
} from './types.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DB_PATH = path.join(PACKAGE_ROOT, 'data', 'telemetry.sqlite');
const CONFIG_PATH = path.join(PACKAGE_ROOT, 'data', 'telemetry.config.json');

/** Tool-name prefixes and exact names mapped to a category. First match wins. */
const CATEGORY_RULES: Array<{ test: (name: string) => boolean; category: OperationCategory }> = [
  {
    test: (n) => n.startsWith('export_') || n === 'add_to_render_queue' || n === 'compress_export' || n === 'get_render_queue_status',
    category: 'export'
  },
  { test: (n) => n === 'export_frame' || n === 'check_offline_media' || n === 'read_sequence_captions', category: 'qa' },
  {
    test: (n) =>
      n.includes('mogrt') ||
      n === 'add_text_overlay' ||
      n === 'build_motion_graphics_demo' ||
      n === 'build_brand_spot_from_mogrt_and_assets' ||
      n === 'assemble_product_spot',
    category: 'graphics'
  },
  { test: (n) => n.startsWith('detect_') || n.startsWith('get_') || n.startsWith('list_') || n.startsWith('find_'), category: 'analysis' },
  { test: () => true, category: 'premiere' }
];

export function categorizeTool(name: string): OperationCategory {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(name)) return rule.category;
  }
  return 'other';
}

/** A handle that records nothing, handed out when telemetry is off. */
const NOOP_HANDLE: OperationHandle = {
  operationId: 'noop',
  sessionId: null,
  success: () => undefined,
  fail: () => undefined,
  markGuiFallback: () => undefined,
  markRetry: () => undefined
};

function envFlag(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return null;
}

export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<TelemetryConfig> = {}
): TelemetryConfig {
  let fileConfig: Partial<TelemetryConfig> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<TelemetryConfig>;
    }
  } catch {
    // A malformed config file must not stop the server booting.
    fileConfig = {};
  }

  const disabled = envFlag(env.BUILDX_TELEMETRY_DISABLED);
  const enabledFlag = envFlag(env.BUILDX_TELEMETRY_ENABLED);
  const enabled =
    overrides.enabled ??
    (disabled === true ? false : enabledFlag !== null ? enabledFlag : fileConfig.enabled ?? true);

  const costRaw = env.BUILDX_TELEMETRY_HOURLY_LABOR_COST;
  const costFromEnv = costRaw === undefined ? null : Number(costRaw);
  // `?? ` would treat an explicit null override as "unset", so membership is
  // checked instead: passing null must mean "no labour cost", not "fall back".
  const hourlyLaborCost = 'hourlyLaborCost' in overrides
    ? (overrides.hourlyLaborCost ?? null)
    : (costFromEnv !== null && Number.isFinite(costFromEnv)
      ? costFromEnv
      : typeof fileConfig.hourlyLaborCost === 'number'
        ? fileConfig.hourlyLaborCost
        : null);

  return {
    enabled,
    databasePath:
      overrides.databasePath ?? env.BUILDX_TELEMETRY_DB ?? fileConfig.databasePath ?? DEFAULT_DB_PATH,
    hourlyLaborCost,
    currency: overrides.currency ?? env.BUILDX_TELEMETRY_CURRENCY ?? fileConfig.currency ?? '$',
    autoSession:
      overrides.autoSession ?? envFlag(env.BUILDX_TELEMETRY_AUTO_SESSION) ?? fileConfig.autoSession ?? true,
    sessionId:
      overrides.sessionId ?? env.BUILDX_TELEMETRY_SESSION_ID ?? fileConfig.sessionId ?? null,
    flushThreshold: overrides.flushThreshold ?? fileConfig.flushThreshold ?? 25,
    flushIntervalMs: overrides.flushIntervalMs ?? fileConfig.flushIntervalMs ?? 2000
  };
}

export interface TelemetryOptions {
  config?: Partial<TelemetryConfig>;
  env?: NodeJS.ProcessEnv;
  now?: Clock;
}

export class Telemetry {
  private readonly logger = new Logger('Telemetry');
  private config: TelemetryConfig;
  private readonly db: TelemetryDatabase;
  private readonly sessions: SessionManager;
  private readonly operations: OperationTracker;
  private readonly now: Clock;
  private activeSessionId: string | null = null;
  private started = false;

  constructor(options: TelemetryOptions = {}) {
    this.config = resolveConfig(options.env ?? process.env, options.config ?? {});
    this.now = options.now ?? (() => Date.now());
    this.db = new TelemetryDatabase(
      this.config.databasePath,
      this.config.flushThreshold,
      this.config.flushIntervalMs
    );
    this.sessions = new SessionManager(this.db, this.now);
    this.operations = new OperationTracker(this.db, this.sessions, this.now);
  }

  /** Opens the store on first use. Never throws. */
  private ensureStarted(): boolean {
    if (!this.config.enabled) return false;
    if (this.started) return this.db.isAvailable();
    this.started = true;
    const ok = this.db.open();
    if (!ok) {
      this.logger.warn(
        'Telemetry disabled for this run: no SQLite store. node:sqlite requires Node 22.5 or newer.'
      );
    }
    return ok;
  }

  /** Runs a telemetry action, absorbing any failure. */
  private safe<T>(context: string, action: () => T, fallback: T): T {
    if (!this.ensureStarted()) return fallback;
    try {
      return action();
    } catch (error) {
      this.db.recordInternalError(context, error);
      return fallback;
    }
  }

  isEnabled(): boolean {
    return this.config.enabled && this.ensureStarted();
  }

  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  getDatabasePath(): string {
    return this.config.databasePath;
  }

  getActiveSessionId(): string | null {
    if (this.activeSessionId) return this.activeSessionId;
    // Report a pinned-but-not-yet-touched session honestly, without opening one.
    if (this.config.sessionId && this.ensureStarted()) {
      const pinned = this.sessions.getSession(this.config.sessionId);
      if (pinned && !pinned.completedAt) return pinned.sessionId;
    }
    return null;
  }

  // ---- sessions ----

  startSession(input: StartSessionInput): SessionRecord | null {
    return this.safe(
      'startSession',
      () => {
        // Adopt an unattributed auto-session rather than leaving it orphaned.
        if (this.activeSessionId) {
          const active = this.sessions.getSession(this.activeSessionId);
          if (active && active.projectName === UNATTRIBUTED && active.finalStatus === 'in_progress') {
            this.sessions.relabelSession(this.activeSessionId, input);
            return this.sessions.getSession(this.activeSessionId);
          }
          this.sessions.endSession(this.activeSessionId, 'abandoned');
        }
        const record = this.sessions.startSession(input);
        this.activeSessionId = record.sessionId;
        this.operations.clearRetryState(record.sessionId);
        return record;
      },
      null
    );
  }

  endSession(status: SessionStatus = 'success', sessionId?: string): SessionRecord | null {
    return this.safe(
      'endSession',
      () => {
        const target = this.resolveSession(sessionId);
        if (!target) return null;
        this.db.flush();
        const record = this.sessions.endSession(target, status);
        if (target === this.activeSessionId) this.activeSessionId = null;
        this.operations.clearRetryState(target);
        this.db.flush();
        return record;
      },
      null
    );
  }

  /**
   * Resolves the session an explicitly-targeted call should act on: the caller's
   * id, else this process's active session, else a still-open pinned session.
   * Unlike ensureSession() this never opens a new session — a call that names no
   * session must not manufacture one just to attach a stage or a correction to it.
   */
  private resolveSession(sessionId?: string): string | null {
    if (sessionId) return sessionId;
    if (this.activeSessionId) return this.activeSessionId;
    if (this.config.sessionId) {
      const pinned = this.sessions.getSession(this.config.sessionId);
      if (pinned && !pinned.completedAt) return pinned.sessionId;
    }
    return null;
  }

  /** Returns the active session id, opening an unattributed one if configured to. */
  private ensureSession(): string | null {
    if (this.activeSessionId) return this.activeSessionId;
    // A pinned id lets a workflow spread over many short-lived server processes
    // report as one session. Only an existing, still-open session is adopted:
    // pinning a finished or unknown id must not silently resurrect or invent it.
    if (this.config.sessionId) {
      const pinned = this.sessions.getSession(this.config.sessionId);
      if (pinned && !pinned.completedAt) {
        this.activeSessionId = pinned.sessionId;
        return this.activeSessionId;
      }
    }
    if (!this.config.autoSession) return null;
    const record = this.sessions.startSession({
      projectName: UNATTRIBUTED,
      workflowType: 'unattributed',
      notes: 'Opened automatically by an instrumented tool call with no session in progress.'
    });
    this.activeSessionId = record.sessionId;
    return this.activeSessionId;
  }

  setBaseline(baselineHumanMinutes: number | null, sessionId?: string): boolean {
    return this.safe(
      'setBaseline',
      () => {
        const target = this.resolveSession(sessionId);
        if (!target) return false;
        this.sessions.setBaseline(target, baselineHumanMinutes);
        return true;
      },
      false
    );
  }

  // ---- operations ----

  startOperation(input: StartOperationInput): OperationHandle {
    return this.safe(
      'startOperation',
      () => {
        const sessionId = input.sessionId ?? this.ensureSession();
        if (!sessionId) return NOOP_HANDLE;
        return this.operations.start(sessionId, input);
      },
      NOOP_HANDLE
    );
  }

  recordOperation(
    input: StartOperationInput & {
      durationMs: number;
      success?: boolean;
      errorMessage?: string;
      startedMs?: number;
      endedMs?: number;
    }
  ): boolean {
    return this.safe(
      'recordOperation',
      () => {
        const sessionId = input.sessionId ?? this.ensureSession();
        if (!sessionId) return false;
        this.operations.record(sessionId, input);
        return true;
      },
      false
    );
  }

  /**
   * Wraps a tool execution. The wrapped call is invoked outside every telemetry
   * try/catch, so instrumentation can never alter its result or swallow its error.
   */
  async instrumentToolCall<T>(name: string, run: () => Promise<T>, args?: unknown): Promise<T> {
    const handle = this.safe<OperationHandle | null>(
      'instrumentToolCall.begin',
      () => {
        const sessionId = this.ensureSession();
        if (!sessionId) return null;
        this.sessions.incrementCounter(sessionId, 'tool_calls');
        return this.operations.start(sessionId, {
          name,
          category: categorizeTool(name),
          metadata: argSummary(args)
        });
      },
      null
    );

    try {
      const result = await run();
      this.safe('instrumentToolCall.settle', () => this.settleToolCall(handle, result, null), undefined);
      return result;
    } catch (error) {
      this.safe('instrumentToolCall.settle', () => this.settleToolCall(handle, null, error), undefined);
      throw error;
    }
  }

  private settleToolCall(handle: OperationHandle | null, result: unknown, error: unknown): void {
    if (!handle) return;
    const sessionId = handle.sessionId;

    if (error !== null && error !== undefined) {
      handle.fail(error);
      if (sessionId) this.sessions.incrementCounter(sessionId, 'failed_calls');
      return;
    }

    const analysis = analyseResult(result);
    if (analysis.failed) {
      handle.fail(analysis.errorMessage ?? 'Tool reported success: false', analysis.metadata);
      if (sessionId) this.sessions.incrementCounter(sessionId, 'failed_calls');
      return;
    }

    handle.success(analysis.metadata);
    if (sessionId) this.sessions.incrementCounter(sessionId, 'successful_calls');
  }

  // ---- stages ----

  startStage(stage: WorkflowStage, sessionId?: string): boolean {
    return this.safe(
      'startStage',
      () => {
        const target = sessionId ?? this.ensureSession();
        if (!target) return false;
        this.sessions.startStage(target, stage);
        return true;
      },
      false
    );
  }

  endStage(stage: WorkflowStage, sessionId?: string): number | null {
    return this.safe(
      'endStage',
      () => {
        const target = this.resolveSession(sessionId);
        if (!target) return null;
        return this.sessions.endStage(target, stage);
      },
      null
    );
  }

  // ---- human involvement ----

  startHumanActivity(kind: HumanActivityKind = 'intervention', reason?: string, sessionId?: string): boolean {
    return this.safe(
      'startHumanActivity',
      () => {
        const target = sessionId ?? this.ensureSession();
        if (!target) return false;
        this.sessions.startHumanActivity(target, kind, reason);
        return true;
      },
      false
    );
  }

  stopHumanActivity(kind: HumanActivityKind = 'intervention', sessionId?: string): number | null {
    return this.safe(
      'stopHumanActivity',
      () => {
        const target = this.resolveSession(sessionId);
        if (!target) return null;
        const duration = this.sessions.stopHumanActivity(target, kind);
        if (duration !== null) this.sessions.recomputeAggregates(target);
        return duration;
      },
      null
    );
  }

  recordManualCorrection(reason?: string, durationMs = 0, sessionId?: string): boolean {
    return this.safe(
      'recordManualCorrection',
      () => {
        const target = sessionId ?? this.ensureSession();
        if (!target) return false;
        this.sessions.recordManualCorrection(target, reason, durationMs);
        return true;
      },
      false
    );
  }

  recordQaCheck(passed: boolean, name?: string, detail?: string, sessionId?: string): boolean {
    return this.safe(
      'recordQaCheck',
      () => {
        const target = sessionId ?? this.ensureSession();
        if (!target) return false;
        this.sessions.recordQaCheck(target, passed, name, detail);
        return true;
      },
      false
    );
  }

  /** Records one automated QA pass against the active session. */
  recordQaRun(run: Omit<QaRunRecord, 'sessionId'>, sessionId?: string): boolean {
    return this.safe(
      'recordQaRun',
      () => {
        const target = sessionId ?? this.ensureSession();
        if (!target) return false;
        this.sessions.recordQaRun(target, { ...run, sessionId: target });
        return true;
      },
      false
    );
  }

  getQaRuns(sessionId?: string): Array<Record<string, unknown>> {
    return this.safe(
      'getQaRuns',
      () => {
        const target = this.resolveSession(sessionId);
        if (!target) return [];
        return this.sessions.getQaRuns(target);
      },
      []
    );
  }

  /** Records a GUI fallback as its own operation — human time, not machine time. */
  recordGuiFallback(operation: string, reason?: string, durationMs = 0, sessionId?: string): boolean {
    return this.safe(
      'recordGuiFallback',
      () => {
        const target = sessionId ?? this.ensureSession();
        if (!target) return false;
        this.operations.record(target, {
          name: operation,
          category: 'gui_fallback',
          durationMs,
          success: true,
          guiFallback: true,
          metadata: reason ? { reason } : {}
        });
        this.sessions.incrementCounter(target, 'gui_fallbacks');
        return true;
      },
      false
    );
  }

  // ---- reporting ----

  getSessionReport(sessionId?: string): SessionReport | null {
    return this.safe(
      'getSessionReport',
      () => {
        const target = this.resolveSession(sessionId);
        const session = target ? this.sessions.getSession(target) : this.sessions.getLastSession();
        if (!session) return null;
        const refreshed = this.sessions.recomputeAggregates(session.sessionId) ?? session;
        return {
          session: refreshed,
          stages: this.sessions.getStageBreakdown(refreshed.sessionId),
          categoryBreakdown: this.categoryBreakdown(refreshed.sessionId),
          baseline: computeBaseline(refreshed, this.config.hourlyLaborCost, this.config.currency)
        };
      },
      null
    );
  }

  renderSessionReport(sessionId?: string): string {
    const report = this.getSessionReport(sessionId);
    if (!report) {
      return this.isEnabled()
        ? 'No telemetry sessions recorded yet.'
        : `Telemetry is disabled${this.db.getUnavailableReason() ? ` (${this.db.getUnavailableReason()})` : ''}.`;
    }
    return renderSessionReport(report);
  }

  private categoryBreakdown(sessionId: string): SessionReport['categoryBreakdown'] {
    return this.db
      .query<{ category: unknown; total: unknown }>(
        `SELECT category, SUM(COALESCE(duration_ms, 0)) AS total
         FROM operations WHERE session_id = ? GROUP BY category`,
        [sessionId]
      )
      .map((row) => ({ stage: String(row.category), durationMs: Number(row.total ?? 0) }));
  }

  getRecentSessions(limit = 10): SessionRecord[] {
    return this.safe('getRecentSessions', () => this.sessions.getRecentSessions(limit), []);
  }

  renderRecentSessions(limit = 10): string {
    return renderSessionList(this.getRecentSessions(limit));
  }

  getMonthlySummary(month: string): MonthlySummary | null {
    return this.safe(
      'getMonthlySummary',
      () =>
        buildMonthlySummary(month, this.sessions.getSessionsForMonth(month), {
          hourlyLaborCost: this.config.hourlyLaborCost,
          currency: this.config.currency
        }),
      null
    );
  }

  renderMonthlySummary(month: string): string {
    const summary = this.getMonthlySummary(month);
    if (!summary) return 'Telemetry is unavailable.';
    return renderMonthlySummary(summary);
  }

  /** Flushes buffered rows and closes the store. Safe to call more than once. */
  shutdown(): void {
    try {
      this.db.flush();
      this.db.close();
    } catch (error) {
      this.logger.warn(`Telemetry shutdown problem: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Updates the live config and persists the durable fields to
   * data/telemetry.config.json. `enabled` and `databasePath` only take effect on
   * the next server start, which the caller is told about.
   */
  updateConfig(patch: Partial<Pick<TelemetryConfig, 'enabled' | 'hourlyLaborCost' | 'currency' | 'autoSession'>>): TelemetryConfig {
    if (patch.hourlyLaborCost !== undefined) this.config.hourlyLaborCost = patch.hourlyLaborCost;
    if (patch.currency !== undefined) this.config.currency = patch.currency;
    if (patch.autoSession !== undefined) this.config.autoSession = patch.autoSession;
    if (patch.enabled !== undefined) this.config.enabled = patch.enabled;

    try {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify(
          {
            enabled: this.config.enabled,
            hourlyLaborCost: this.config.hourlyLaborCost,
            currency: this.config.currency,
            autoSession: this.config.autoSession
          },
          null,
          2
        )
      );
    } catch (error) {
      this.logger.warn(
        `Could not persist telemetry config: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return { ...this.config };
  }

  /** Test seam: forces buffered writes to disk. */
  flush(): void {
    this.safe('flush', () => this.db.flush(), undefined);
  }
}

export const UNATTRIBUTED = '(unattributed)';

/** Names tool arguments without storing media paths or transcript content wholesale. */
function argSummary(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  const keys = Object.keys(args as Record<string, unknown>);
  return keys.length > 0 ? { argKeys: keys } : {};
}

interface ResultAnalysis {
  failed: boolean;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

/**
 * executeTool returns `{success:false}` instead of throwing, so a failed call has
 * to be read out of the payload. A response carrying `accepted:true` is the
 * expanded dispatcher's catch-all, which this repo has verified does nothing —
 * it is flagged in metadata rather than counted as a real success.
 */
export function analyseResult(result: unknown): ResultAnalysis {
  const metadata: Record<string, unknown> = {};
  if (!result || typeof result !== 'object') return { failed: false, errorMessage: null, metadata };

  const record = result as Record<string, unknown>;
  if (record.accepted === true) metadata.stubbedResponse = true;

  if (record.success === false) {
    const error = record.error;
    return {
      failed: true,
      errorMessage: typeof error === 'string' ? error : error ? String(error) : null,
      metadata
    };
  }
  return { failed: false, errorMessage: null, metadata };
}

/** Process-wide instance used by the MCP server. */
export const telemetry = new Telemetry();
