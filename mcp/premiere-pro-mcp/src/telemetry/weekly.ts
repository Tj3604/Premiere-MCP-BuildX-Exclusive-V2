/**
 * Weekly report from local telemetry: shorts made, time per stage, the tools that
 * failed most, and QA (runs, gate blocks and overrides). Reads only.
 *
 * Honest about gaps: a number that was never recorded is reported as missing,
 * not as zero — stage time exists only when start/end_workflow_stage were called,
 * and shorts are counted from exports made since deliverables were recorded.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { PACKAGE_ROOT } from '../utils/package-root.js';

interface Db {
  prepare(sql: string): { all(...params: unknown[]): any[]; get(...params: unknown[]): any };
  close(): void;
}

export function openReadOnly(file: string): Db {
  const require = createRequire(path.join(PACKAGE_ROOT, 'package.json'));
  const sqlite = require('node:sqlite') as { DatabaseSync: new (f: string, o?: Record<string, unknown>) => Db };
  return new sqlite.DatabaseSync(file, { readOnly: true });
}

export interface WeekWindow {
  fromMs: number;
  toMs: number;
  label: string;
}

/** The 7 days ending now, or the Monday-to-Sunday week containing `date` (YYYY-MM-DD). */
export function weekWindow(date?: string, now = Date.now()): WeekWindow {
  if (!date) return { fromMs: now - 7 * 86400000, toMs: now, label: 'last 7 days' };
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${date} (use YYYY-MM-DD)`);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const next = new Date(monday);
  next.setDate(monday.getDate() + 7);
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const sunday = new Date(next.getTime() - 86400000);
  return { fromMs: monday.getTime(), toMs: next.getTime(), label: `week of ${fmt(monday)} to ${fmt(sunday)}` };
}

export interface WeeklyReport {
  window: WeekWindow;
  sessions: { total: number; projects: string[]; unattributed: number; humanMs: number; automatedMs: number };
  shorts: { vertical: string[]; landscape: string[]; unknownSize: string[]; platformVersions: number; sequencesBuilt: number };
  stages: Array<{ stage: string; runs: number; totalMs: number; avgMs: number }>;
  failingTools: Array<{ tool: string; failed: number; calls: number; rate: number; topError: string | null }>;
  qa: { runs: number; byStatus: Record<string, number>; overrides: Array<{ at: string; detail: string }> };
  gaps: string[];
}

const isVertical = (w: number | null, h: number | null) => !!w && !!h && h > w;

/** "2026-10-07 08:54" in the machine's own time zone. */
function localStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildWeeklyReport(db: Db, window: WeekWindow): WeeklyReport {
  const { fromMs, toMs } = window;
  const sessions = db.prepare('select project_name, human_active_ms, automated_processing_ms from sessions where started_ms >= ? and started_ms < ?').all(fromMs, toMs);
  const projects = [...new Set(sessions.map((s) => s.project_name).filter((p: string) => p !== '(unattributed)'))] as string[];

  const ops = db.prepare('select name, success, error_message, metadata from operations where started_ms >= ? and started_ms < ?').all(fromMs, toMs);
  const vertical = new Set<string>();
  const landscape = new Set<string>();
  const unknown = new Set<string>();
  let platformVersions = 0;
  let sequencesBuilt = 0;
  for (const op of ops) {
    if (!op.success || !op.metadata) continue;
    let meta: any;
    try {
      meta = JSON.parse(op.metadata);
    } catch {
      continue;
    }
    for (const d of meta.outputs ?? []) {
      if (isVertical(d.width, d.height)) vertical.add(d.file);
      else if (d.width && d.height) landscape.add(d.file);
      else unknown.add(d.file);
    }
    platformVersions += (meta.platformVersions ?? []).length;
    sequencesBuilt += Number(meta.sequencesBuilt ?? 0);
  }

  const stages = db
    .prepare('select stage, count(*) runs, sum(duration_ms) total from stages where started_ms >= ? and started_ms < ? and duration_ms is not null group by stage order by total desc')
    .all(fromMs, toMs)
    .map((r) => ({ stage: r.stage, runs: r.runs, totalMs: r.total, avgMs: Math.round(r.total / r.runs) }));

  const failingTools = db
    .prepare('select name, count(*) calls, sum(case when success = 0 then 1 else 0 end) failed from operations where started_ms >= ? and started_ms < ? group by name having failed > 0 order by failed desc, calls desc limit 10')
    .all(fromMs, toMs)
    .map((r) => {
      const top = db
        .prepare('select error_message, count(*) n from operations where name = ? and success = 0 and started_ms >= ? and started_ms < ? and error_message is not null group by error_message order by n desc limit 1')
        .get(r.name, fromMs, toMs);
      return { tool: r.name, failed: r.failed, calls: r.calls, rate: Math.round((r.failed / r.calls) * 100), topError: top?.error_message ?? null };
    });

  const qaRuns = db.prepare('select final_status from qa_runs where ran_at_ms >= ? and ran_at_ms < ?').all(fromMs, toMs);
  const byStatus: Record<string, number> = {};
  for (const r of qaRuns) byStatus[r.final_status] = (byStatus[r.final_status] ?? 0) + 1;
  const overrides = db
    .prepare("select recorded_ms, detail from qa_checks where name = 'export gate override' and recorded_ms >= ? and recorded_ms < ? order by recorded_ms")
    .all(fromMs, toMs)
    .map((r) => ({ at: localStamp(r.recorded_ms), detail: r.detail ?? '' }));

  const gaps: string[] = [];
  if (!sessions.length) gaps.push('No telemetry sessions in this window.');
  if (!stages.length) gaps.push('No stage timings — call start_workflow_stage / end_workflow_stage around each stage to get time per stage.');
  if (!ops.some((o) => o.metadata && /"outputs"|"platformVersions"|"sequencesBuilt"/.test(o.metadata))) {
    gaps.push('No exports recorded with deliverables — shorts are counted from export tools run since 2026-10-07.');
  }
  if (sessions.length && sessions.every((s) => s.project_name === '(unattributed)')) {
    gaps.push('Every session is unattributed — start_telemetry_session with a project name to see work per project.');
  }

  return {
    window,
    sessions: {
      total: sessions.length,
      projects,
      unattributed: sessions.filter((s) => s.project_name === '(unattributed)').length,
      humanMs: sessions.reduce((a, s) => a + (s.human_active_ms ?? 0), 0),
      automatedMs: sessions.reduce((a, s) => a + (s.automated_processing_ms ?? 0), 0)
    },
    shorts: { vertical: [...vertical].sort(), landscape: [...landscape].sort(), unknownSize: [...unknown].sort(), platformVersions, sequencesBuilt },
    stages,
    failingTools,
    qa: { runs: qaRuns.length, byStatus, overrides },
    gaps
  };
}

function minutes(ms: number): string {
  if (!ms) return '0 min';
  const m = ms / 60000;
  return m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`;
}

export function renderWeeklyReport(r: WeeklyReport): string {
  const lines = [
    `BUILDX WEEKLY REPORT — ${r.window.label}`,
    '',
    'SHORTS MADE',
    `  ${r.shorts.vertical.length} vertical short${r.shorts.vertical.length === 1 ? '' : 's'} exported${r.shorts.vertical.length ? `: ${r.shorts.vertical.join(', ')}` : ''}`,
    ...(r.shorts.landscape.length ? [`  ${r.shorts.landscape.length} landscape export(s): ${r.shorts.landscape.join(', ')}`] : []),
    ...(r.shorts.unknownSize.length ? [`  ${r.shorts.unknownSize.length} export(s) whose size could not be read: ${r.shorts.unknownSize.join(', ')}`] : []),
    `  ${r.shorts.sequencesBuilt} short sequence(s) built, ${r.shorts.platformVersions} platform version file(s) written`,
    '',
    'TIME',
    `  ${r.sessions.total} session(s)${r.sessions.projects.length ? ` — ${r.sessions.projects.join(', ')}` : ''}${r.sessions.unattributed ? ` (${r.sessions.unattributed} unattributed)` : ''}`,
    `  Human ${minutes(r.sessions.humanMs)} · machine ${minutes(r.sessions.automatedMs)}`,
    ...(r.stages.length
      ? r.stages.map((s) => `  ${s.stage.padEnd(16)} ${minutes(s.totalMs).padStart(8)} over ${s.runs} run(s), avg ${minutes(s.avgMs)}`)
      : ['  Per stage: not recorded']),
    '',
    'TOOLS THAT FAILED MOST',
    ...(r.failingTools.length
      ? r.failingTools.map((t) => `  ${t.tool.padEnd(26)} ${t.failed}/${t.calls} failed (${t.rate}%)${t.topError ? ` — ${t.topError.slice(0, 90)}` : ''}`)
      : ['  None']),
    '',
    'QA',
    `  ${r.qa.runs} run(s)${Object.keys(r.qa.byStatus).length ? `: ${Object.entries(r.qa.byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`,
    ...(r.qa.overrides.length ? ['  Gate overrides:', ...r.qa.overrides.map((o) => `    ${o.at} — ${o.detail.slice(0, 140)}`)] : ['  No gate overrides']),
    ...(r.gaps.length ? ['', 'MISSING DATA', ...r.gaps.map((g) => `  - ${g}`)] : [])
  ];
  return lines.join('\n');
}
