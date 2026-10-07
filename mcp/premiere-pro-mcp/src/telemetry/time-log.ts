/**
 * The weekly time log for the Content Desk. Its shape is a contract — the Desk
 * reads it — so it is built here and nowhere else, and a test pins the format:
 *
 * { kind: "buildx-time-log", version: 1, weekStart, weekEnd, generatedAt,
 *   untrackedActiveMin, videos: [{ id, title, type, status, exportedOn?,
 *   activeMin, automatedMin, stages }] }
 *
 * Weeks are Monday to Sunday in the machine's local time. Minutes are rounded to
 * one decimal; a video's stages are its active minutes and add up to activeMin.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeTime, loadTimeInputs, TIME_STAGES, type QueryFn, type TimeStage } from './time-tracking.js';
import type { VideoType } from './videos.js';

export interface TimeLogVideo {
  id: string;
  title: string;
  type: VideoType;
  status: 'exported' | 'in-progress';
  exportedOn?: string;
  activeMin: number;
  automatedMin: number;
  stages: Partial<Record<TimeStage, number>>;
}

export interface TimeLog {
  kind: 'buildx-time-log';
  version: 1;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  untrackedActiveMin: number;
  videos: TimeLogVideo[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const toMin = (ms: number) => ms / 60000;

/** YYYY-MM-DD in local time. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface Week {
  startMs: number;
  endMs: number;
  weekStart: string;
  weekEnd: string;
}

/** The Monday-to-Sunday week (local time) containing weekStart, or now. */
export function weekOf(weekStart: string | undefined, now: number): Week {
  let d: Date;
  if (weekStart) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error(`weekStart must be YYYY-MM-DD, got "${weekStart}"`);
    const [y, m, day] = weekStart.split('-').map(Number) as [number, number, number];
    d = new Date(y, m - 1, day);
    if (d.getMonth() !== m - 1) throw new Error(`Not a real date: ${weekStart}`);
  } else {
    d = new Date(now);
  }
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { startMs: monday.getTime(), endMs: nextMonday.getTime(), weekStart: localDate(monday.getTime()), weekEnd: localDate(sunday.getTime()) };
}

export function buildTimeLog(query: QueryFn, weekStart: string | undefined, now: number): TimeLog {
  const week = weekOf(weekStart, now);
  const totals = computeTime(loadTimeInputs(query, week.startMs, week.endMs), week.startMs, week.endMs);
  const meta = new Map(
    query<{ id: string; title: string; type: string; exported_ms: number | null }>('SELECT id, title, type, exported_ms FROM videos').map((v) => [v.id, v])
  );

  const videos: TimeLogVideo[] = [];
  for (const [id, t] of Object.entries(totals.videos)) {
    const v = meta.get(id);
    const stages: Partial<Record<TimeStage, number>> = {};
    for (const s of TIME_STAGES) {
      const m = round1(toMin(t.stages[s] ?? 0));
      if (m > 0) stages[s] = m;
    }
    // activeMin is the sum of the rounded stages so the two always agree.
    const activeMin = round1(Object.values(stages).reduce((a, b) => a + (b ?? 0), 0));
    const automatedMin = round1(toMin(t.automatedMs));
    if (activeMin === 0 && automatedMin === 0) continue;
    const exported = v?.exported_ms !== null && v?.exported_ms !== undefined && v.exported_ms < week.endMs;
    videos.push({
      id,
      title: v?.title ?? id,
      type: (v?.type ?? 'other') as VideoType,
      status: exported ? 'exported' : 'in-progress',
      ...(exported ? { exportedOn: localDate(v!.exported_ms!) } : {}),
      activeMin,
      automatedMin,
      stages
    });
  }
  videos.sort((a, b) => b.activeMin - a.activeMin || a.id.localeCompare(b.id));

  return {
    kind: 'buildx-time-log',
    version: 1,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    generatedAt: new Date(now).toISOString(),
    untrackedActiveMin: round1(toMin(totals.untrackedActiveMs)),
    videos
  };
}

/** $BUILDX_TIME_LOG_DIR (a leading ~ is expanded), else ~/Claude Video Editor/time-logs. */
export function timeLogDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.BUILDX_TIME_LOG_DIR?.trim();
  if (!raw) return path.join(os.homedir(), 'Claude Video Editor', 'time-logs');
  return raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw);
}

export function timeLogPath(dir: string, weekStart: string): string {
  return path.join(dir, `buildx-time-${weekStart}.json`);
}

/** Creates the folder if needed and swaps the file in whole, so a reader never sees half of it. */
export function writeTimeLog(log: TimeLog, dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = timeLogPath(dir, log.weekStart);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(log, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return file;
}
