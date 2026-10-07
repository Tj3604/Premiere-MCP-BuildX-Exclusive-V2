/**
 * Per-video time tracking: which video the editor is working on, and every tool
 * call and stage recorded against it. Lives in the telemetry database in its own
 * tables (VIDEO_SCHEMA) — the existing sessions / stages / human_activity tables
 * are not changed.
 *
 * Every tool call is recorded, tagged with the current video or with none, so the
 * time log can also report active time that was not tied to a video.
 */

import type { TelemetryDatabase } from './database.js';

export const VIDEO_TYPES = ['short', 'podcast', 'longform', 'ad', 'testimonial', 'other'] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

export const VIDEO_SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL,
  created_ms   INTEGER NOT NULL,
  updated_ms   INTEGER NOT NULL,
  exported_ms  INTEGER
);

CREATE TABLE IF NOT EXISTS video_activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  started_ms  INTEGER NOT NULL,
  ended_ms    INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  success     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_video_activity_started ON video_activity(started_ms);
CREATE INDEX IF NOT EXISTS idx_video_activity_video ON video_activity(video_id);

CREATE TABLE IF NOT EXISTS current_video (
  slot      TEXT PRIMARY KEY,
  video_id  TEXT,
  set_ms    INTEGER NOT NULL
);
`;

export interface VideoRecord {
  id: string;
  title: string;
  type: VideoType;
  createdMs: number;
  updatedMs: number;
  exportedMs: number | null;
}

interface VideoRow {
  id: string;
  title: string;
  type: string;
  created_ms: number;
  updated_ms: number;
  exported_ms: number | null;
}

function toRecord(r: VideoRow): VideoRecord {
  return { id: r.id, title: r.title, type: r.type as VideoType, createdMs: r.created_ms, updatedMs: r.updated_ms, exportedMs: r.exported_ms };
}

export function isVideoType(value: unknown): value is VideoType {
  return typeof value === 'string' && (VIDEO_TYPES as readonly string[]).includes(value);
}

export class VideoTracker {
  constructor(
    private readonly db: TelemetryDatabase,
    private readonly now: () => number
  ) {}

  /** Makes this the current video, creating or updating it. */
  setCurrent(id: string, title: string, type: VideoType): VideoRecord {
    const vid = id.trim();
    if (!vid) throw new Error('Video id is empty.');
    if (!isVideoType(type)) throw new Error(`Video type must be one of ${VIDEO_TYPES.join(', ')} — got "${type}".`);
    const t = this.now();
    this.db.run(
      `INSERT INTO videos (id, title, type, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, type = excluded.type, updated_ms = excluded.updated_ms`,
      [vid, title.trim() || vid, type, t, t]
    );
    this.db.run(`INSERT OR REPLACE INTO current_video (slot, video_id, set_ms) VALUES ('current', ?, ?)`, [vid, t]);
    return this.get(vid)!;
  }

  /** Stops attributing work to any video. */
  clearCurrent(): void {
    this.db.run(`INSERT OR REPLACE INTO current_video (slot, video_id, set_ms) VALUES ('current', NULL, ?)`, [this.now()]);
  }

  get(id: string): VideoRecord | null {
    const row = this.db.queryOne<VideoRow>('SELECT * FROM videos WHERE id = ?', [id]);
    return row ? toRecord(row) : null;
  }

  current(): VideoRecord | null {
    const row = this.db.queryOne<{ video_id: string | null }>(`SELECT video_id FROM current_video WHERE slot = 'current'`);
    return row?.video_id ? this.get(row.video_id) : null;
  }

  /** Marks a video exported now. Throws for an unknown id. */
  markExported(id: string): VideoRecord {
    const video = this.get(id);
    if (!video) throw new Error(`No video "${id}" — set_current_video creates one.`);
    this.db.run('UPDATE videos SET exported_ms = ?, updated_ms = ? WHERE id = ?', [this.now(), this.now(), id]);
    return this.get(id)!;
  }

  /** Marks the current video exported, if there is one. */
  markCurrentExported(): VideoRecord | null {
    const video = this.current();
    return video ? this.markExported(video.id) : null;
  }

  recordTool(name: string, startedMs: number, endedMs: number, success: boolean | null): void {
    this.record('tool', name, startedMs, endedMs, success);
  }

  recordStage(stage: string, startedMs: number, endedMs: number): void {
    this.record('stage', stage, startedMs, endedMs, null);
  }

  private record(kind: 'tool' | 'stage', name: string, startedMs: number, endedMs: number, success: boolean | null): void {
    const video = this.current();
    this.db.enqueue(
      'INSERT INTO video_activity (video_id, kind, name, started_ms, ended_ms, duration_ms, success) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [video?.id ?? null, kind, name, startedMs, endedMs, Math.max(0, endedMs - startedMs), success === null ? null : success ? 1 : 0]
    );
  }
}
