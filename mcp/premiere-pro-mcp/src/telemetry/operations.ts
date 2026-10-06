/**
 * Operation instrumentation.
 *
 * Callers never touch timestamps. They start an operation, then call success()
 * or fail() on the handle, and the duration is worked out here.
 */

import { randomUUID } from 'node:crypto';
import type { TelemetryDatabase } from './database.js';
import type { SessionManager } from './session.js';
import type { OperationCategory, OperationHandle, StartOperationInput } from './types.js';
import type { Clock } from './session.js';

/** Error text that means the bridge never answered, rather than answered badly. */
const TIMEOUT_PATTERN = /timed?\s*out|timeout|ETIMEDOUT|no response from/i;

export function looksLikeTimeout(message: string): boolean {
  return TIMEOUT_PATTERN.test(message);
}

interface OperationState {
  operationId: string;
  sessionId: string;
  name: string;
  category: OperationCategory;
  startedMs: number;
  retryCount: number;
  guiFallback: boolean;
  metadata: Record<string, unknown>;
  settled: boolean;
}

export class OperationTracker {
  /**
   * Consecutive failures per session+tool, used to label the next attempt at the
   * same tool as a retry without the caller having to say so.
   */
  private readonly failureStreak = new Map<string, number>();

  constructor(
    private readonly db: TelemetryDatabase,
    private readonly sessions: SessionManager,
    private readonly now: Clock = () => Date.now()
  ) {}

  /** Number of consecutive prior failures of this tool in this session. */
  pendingRetryCount(sessionId: string, name: string): number {
    return this.failureStreak.get(`${sessionId}::${name}`) ?? 0;
  }

  clearRetryState(sessionId?: string): void {
    if (!sessionId) {
      this.failureStreak.clear();
      return;
    }
    for (const key of [...this.failureStreak.keys()]) {
      if (key.startsWith(`${sessionId}::`)) this.failureStreak.delete(key);
    }
  }

  start(sessionId: string, input: StartOperationInput): OperationHandle {
    const state: OperationState = {
      operationId: randomUUID(),
      sessionId,
      name: input.name,
      category: input.category,
      startedMs: this.now(),
      retryCount: this.pendingRetryCount(sessionId, input.name),
      guiFallback: false,
      metadata: { ...(input.metadata ?? {}) },
      settled: false
    };

    this.db.enqueue(
      `INSERT INTO operations
        (operation_id, session_id, name, category, started_ms, retry_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [state.operationId, sessionId, state.name, state.category, state.startedMs, state.retryCount]
    );

    const settle = (success: boolean, error?: unknown, extra?: Record<string, unknown>): void => {
      if (state.settled) return;
      state.settled = true;

      const endedMs = this.now();
      const durationMs = Math.max(0, endedMs - state.startedMs);
      const message = error === undefined ? null : error instanceof Error ? error.message : String(error);
      const timedOut = !success && message !== null && looksLikeTimeout(message);
      const metadata = { ...state.metadata, ...(extra ?? {}) };

      this.db.enqueue(
        `UPDATE operations
           SET ended_ms = ?, duration_ms = ?, success = ?, retry_count = ?,
               timed_out = ?, gui_fallback = ?, error_message = ?, metadata = ?
         WHERE operation_id = ?`,
        [
          endedMs,
          durationMs,
          success ? 1 : 0,
          state.retryCount,
          timedOut ? 1 : 0,
          state.guiFallback ? 1 : 0,
          message,
          Object.keys(metadata).length > 0 ? safeJson(metadata) : null,
          state.operationId
        ]
      );

      const streakKey = `${state.sessionId}::${state.name}`;
      if (success) {
        this.failureStreak.delete(streakKey);
      } else {
        this.failureStreak.set(streakKey, state.retryCount + 1);
        if (timedOut) this.sessions.incrementCounter(state.sessionId, 'timeout_failures');
      }
      if (state.retryCount > 0) {
        this.sessions.incrementCounter(state.sessionId, 'retries');
      }
    };

    return {
      operationId: state.operationId,
      sessionId,
      success: (metadata?: Record<string, unknown>) => settle(true, undefined, metadata),
      fail: (error: unknown, metadata?: Record<string, unknown>) => settle(false, error, metadata),
      markGuiFallback: (reason?: string) => {
        if (state.guiFallback) return;
        state.guiFallback = true;
        if (reason) state.metadata.guiFallbackReason = reason;
        this.sessions.incrementCounter(state.sessionId, 'gui_fallbacks');
      },
      markRetry: (count?: number) => {
        state.retryCount = count ?? state.retryCount + 1;
      }
    };
  }

  /**
   * Records an already-finished operation, for work timed outside this process
   * (a shell transcription, a render driven by a script).
   *
   * With only a duration the span is back-dated to end now. Recording several
   * such operations in one burst therefore makes them overlap, and overlapping
   * spans are merged rather than summed — pass startedMs/endedMs when the real
   * placement of the work matters.
   */
  record(
    sessionId: string,
    input: StartOperationInput & {
      durationMs: number;
      success?: boolean;
      errorMessage?: string;
      startedMs?: number;
      endedMs?: number;
      guiFallback?: boolean;
    }
  ): void {
    const duration = Math.max(0, input.durationMs);
    const startedMs =
      input.startedMs ?? (input.endedMs !== undefined ? input.endedMs - duration : this.now() - duration);
    const endedMs = input.endedMs ?? startedMs + duration;
    const success = input.success ?? true;
    this.db.enqueue(
      `INSERT INTO operations
        (operation_id, session_id, name, category, started_ms, ended_ms, duration_ms,
         success, gui_fallback, error_message, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        sessionId,
        input.name,
        input.category,
        startedMs,
        endedMs,
        Math.max(0, endedMs - startedMs),
        success ? 1 : 0,
        input.guiFallback ? 1 : 0,
        input.errorMessage ?? null,
        input.metadata ? safeJson(input.metadata) : null
      ]
    );
  }
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
