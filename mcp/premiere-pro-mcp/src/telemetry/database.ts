/**
 * Local-first SQLite store for telemetry.
 *
 * Uses node:sqlite, the runtime's built-in driver, so telemetry adds no npm
 * dependency and no native build step. node:sqlite landed in Node 22.5; on an
 * older runtime the store reports itself unavailable and the whole telemetry
 * layer degrades to a no-op rather than failing an edit.
 *
 * Nothing here ever leaves the machine.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Logger } from '../utils/logger.js';

/** Minimal shape of the bits of node:sqlite we use. */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqliteModule = {
  DatabaseSync: new (filename: string, options?: Record<string, unknown>) => SqliteDatabase;
};

export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id              TEXT PRIMARY KEY,
  project_name            TEXT NOT NULL,
  workflow_type           TEXT NOT NULL,
  started_at              TEXT NOT NULL,
  completed_at            TEXT,
  started_ms              INTEGER NOT NULL,
  completed_ms            INTEGER,
  total_elapsed_ms        INTEGER NOT NULL DEFAULT 0,
  automated_processing_ms INTEGER NOT NULL DEFAULT 0,
  human_active_ms         INTEGER NOT NULL DEFAULT 0,
  tool_calls              INTEGER NOT NULL DEFAULT 0,
  successful_calls        INTEGER NOT NULL DEFAULT 0,
  failed_calls            INTEGER NOT NULL DEFAULT 0,
  timeout_failures        INTEGER NOT NULL DEFAULT 0,
  retries                 INTEGER NOT NULL DEFAULT 0,
  gui_fallbacks           INTEGER NOT NULL DEFAULT 0,
  manual_corrections      INTEGER NOT NULL DEFAULT 0,
  qa_checks               INTEGER NOT NULL DEFAULT 0,
  qa_failures             INTEGER NOT NULL DEFAULT 0,
  baseline_human_minutes  REAL,
  final_status            TEXT NOT NULL DEFAULT 'in_progress',
  notes                   TEXT
);

CREATE TABLE IF NOT EXISTS operations (
  operation_id  TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  started_ms    INTEGER NOT NULL,
  ended_ms      INTEGER,
  duration_ms   INTEGER,
  success       INTEGER,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  timed_out     INTEGER NOT NULL DEFAULT 0,
  gui_fallback  INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata      TEXT
);
CREATE INDEX IF NOT EXISTS idx_operations_session ON operations(session_id);

CREATE TABLE IF NOT EXISTS stages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  stage       TEXT NOT NULL,
  started_ms  INTEGER NOT NULL,
  ended_ms    INTEGER,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stages_session ON stages(session_id);

CREATE TABLE IF NOT EXISTS human_activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  reason      TEXT,
  started_ms  INTEGER NOT NULL,
  ended_ms    INTEGER,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_human_session ON human_activity(session_id);

CREATE TABLE IF NOT EXISTS qa_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  name        TEXT,
  passed      INTEGER NOT NULL,
  detail      TEXT,
  recorded_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_session ON qa_checks(session_id);

CREATE TABLE IF NOT EXISTS telemetry_errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_ms INTEGER NOT NULL,
  context     TEXT,
  message     TEXT
);

CREATE TABLE IF NOT EXISTS qa_runs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id             TEXT,
  project_name           TEXT,
  workflow               TEXT,
  sequence_id            TEXT,
  ran_at_ms              INTEGER NOT NULL,
  duration_ms            INTEGER NOT NULL,
  checks_executed        INTEGER NOT NULL DEFAULT 0,
  checks_passed          INTEGER NOT NULL DEFAULT 0,
  checks_failed          INTEGER NOT NULL DEFAULT 0,
  checks_errored         INTEGER NOT NULL DEFAULT 0,
  checks_review          INTEGER NOT NULL DEFAULT 0,
  checks_skipped         INTEGER NOT NULL DEFAULT 0,
  auto_fixes_attempted   INTEGER NOT NULL DEFAULT 0,
  auto_fixes_successful  INTEGER NOT NULL DEFAULT 0,
  auto_fixes_failed      INTEGER NOT NULL DEFAULT 0,
  first_pass_passed      INTEGER NOT NULL DEFAULT 0,
  first_pass_executed    INTEGER NOT NULL DEFAULT 0,
  first_pass_percent     REAL NOT NULL DEFAULT 0,
  final_passed           INTEGER NOT NULL DEFAULT 0,
  final_executed         INTEGER NOT NULL DEFAULT 0,
  final_percent          REAL NOT NULL DEFAULT 0,
  final_status           TEXT NOT NULL,
  failed_check_ids       TEXT
);
CREATE INDEX IF NOT EXISTS idx_qa_runs_session ON qa_runs(session_id);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** A write held in memory until the next flush. */
interface PendingWrite {
  sql: string;
  params: unknown[];
}

export class TelemetryDatabase {
  private db: SqliteDatabase | null = null;
  private available = false;
  private unavailableReason: string | null = null;
  private readonly logger = new Logger('Telemetry.Database');
  private pending: PendingWrite[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly databasePath: string,
    private readonly flushThreshold = 25,
    private readonly flushIntervalMs = 2000
  ) {}

  /**
   * Opens the database, creating the directory and schema if needed. Returns
   * false instead of throwing when the runtime has no SQLite — the caller is
   * expected to keep working without telemetry.
   */
  open(): boolean {
    if (this.available) return true;
    try {
      const require = createRequire(import.meta.url);
      const sqlite = require('node:sqlite') as SqliteModule;

      if (this.databasePath !== ':memory:') {
        fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
      }

      const db = new sqlite.DatabaseSync(this.databasePath);
      // WAL keeps readers (reporting) from blocking the writer; NORMAL avoids an
      // fsync on every single commit, which matters during a busy timeline build.
      if (this.databasePath !== ':memory:') {
        db.exec('PRAGMA journal_mode = WAL;');
      }
      db.exec('PRAGMA synchronous = NORMAL;');
      db.exec(SCHEMA);
      this.migrate(db);
      db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)').run(
        'schema_version',
        String(SCHEMA_VERSION)
      );

      this.db = db;
      this.available = true;
      this.unavailableReason = null;
      return true;
    } catch (error) {
      this.unavailableReason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Telemetry store unavailable (${this.unavailableReason}). Continuing without telemetry.`
      );
      this.available = false;
      return false;
    }
  }

  /**
   * Adds columns introduced after v1. Idempotent: existing databases gain the new
   * columns, fresh ones already have them. A migration failure disables telemetry
   * rather than corrupting it.
   */
  private migrate(db: SqliteDatabase): void {
    const added: Array<[string, string]> = [
      ['qa_runs_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['qa_reviews', 'INTEGER NOT NULL DEFAULT 0'],
      ['qa_errors', 'INTEGER NOT NULL DEFAULT 0'],
      ['qa_auto_fix_attempts', 'INTEGER NOT NULL DEFAULT 0'],
      ['qa_auto_fix_successes', 'INTEGER NOT NULL DEFAULT 0'],
      ['qa_auto_fix_failures', 'INTEGER NOT NULL DEFAULT 0'],
      ['qa_duration_ms', 'INTEGER NOT NULL DEFAULT 0'],
      ['qa_first_pass_percent', 'REAL'],
      ['qa_final_percent', 'REAL'],
      ['qa_final_status', 'TEXT']
    ];

    const existing = new Set(
      (db.prepare('PRAGMA table_info(sessions)').all() as Array<Record<string, unknown>>).map((row) =>
        String(row.name)
      )
    );

    for (const [column, definition] of added) {
      if (existing.has(column)) continue;
      try {
        db.exec(`ALTER TABLE sessions ADD COLUMN ${column} ${definition};`);
      } catch (error) {
        this.logger.warn(
          `Could not add telemetry column ${column}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getUnavailableReason(): string | null {
    return this.unavailableReason;
  }

  getPath(): string {
    return this.databasePath;
  }

  /**
   * Queues a write. High-frequency rows (operations) go through here so a busy
   * session does not fsync once per tool call.
   */
  enqueue(sql: string, params: unknown[]): void {
    if (!this.available) return;
    this.pending.push({ sql, params });
    if (this.pending.length >= this.flushThreshold) {
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushIntervalMs);
      // Never hold the process open for a telemetry flush.
      this.flushTimer.unref?.();
    }
  }

  /** Executes a write immediately, after draining anything queued before it. */
  run(sql: string, params: unknown[]): void {
    if (!this.available || !this.db) return;
    this.flush();
    try {
      this.db.prepare(sql).run(...params);
    } catch (error) {
      this.recordInternalError('run', error);
    }
  }

  /** Writes every queued row in a single transaction. */
  flush(): void {
    if (!this.available || !this.db || this.pending.length === 0) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const batch = this.pending;
    this.pending = [];
    try {
      this.db.exec('BEGIN');
      for (const write of batch) {
        this.db.prepare(write.sql).run(...write.params);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // A rollback failure means the transaction was never open. Nothing to do.
      }
      this.recordInternalError('flush', error);
    }
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    if (!this.available || !this.db) return [];
    this.flush();
    try {
      return this.db.prepare(sql).all(...params) as T[];
    } catch (error) {
      this.recordInternalError('query', error);
      return [];
    }
  }

  queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    const rows = this.query<T>(sql, params);
    return rows.length > 0 ? (rows[0] as T) : null;
  }

  /**
   * Records a telemetry-internal failure. Best effort by definition: if the
   * store is the thing that broke, this is a no-op and the message only reaches
   * stderr.
   */
  recordInternalError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Telemetry error in ${context}: ${message}`);
    if (!this.db || !this.available) return;
    try {
      this.db
        .prepare('INSERT INTO telemetry_errors (occurred_ms, context, message) VALUES (?, ?, ?)')
        .run(Date.now(), context, message);
    } catch {
      // Swallowed on purpose. Telemetry must never surface an error to the edit.
    }
  }

  close(): void {
    this.flush();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      this.db?.close();
    } catch (error) {
      this.recordInternalError('close', error);
    }
    this.db = null;
    this.available = false;
  }
}
