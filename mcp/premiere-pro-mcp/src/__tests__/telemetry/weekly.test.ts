/**
 * Weekly report: window maths, counting shorts from recorded deliverables, stage
 * time, failing tools, QA overrides, and saying what is missing.
 */

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TelemetryDatabase } from '../../telemetry/database.js';
import { deliverables } from '../../telemetry/telemetry.js';
import { buildWeeklyReport, openReadOnly, renderWeeklyReport, weekWindow } from '../../telemetry/weekly.js';

describe('weekWindow', () => {
  it('is Monday to Sunday around a date, or the last 7 days', () => {
    const w = weekWindow('2026-10-08'); // a Thursday
    expect(w.label).toBe('week of 2026-10-05 to 2026-10-11');
    expect(w.toMs - w.fromMs).toBe(7 * 86400000);
    const now = Date.UTC(2026, 9, 7);
    expect(weekWindow(undefined, now)).toEqual({ fromMs: now - 7 * 86400000, toMs: now, label: 'last 7 days' });
    expect(() => weekWindow('nope')).toThrow(/YYYY-MM-DD/);
  });
});

describe('deliverables', () => {
  it('records file names (never paths) and what was built', () => {
    expect(deliverables('export_with_gate', {}, { status: 'RENDERED', overridden: false, outputPath: '/x/private/a.mp4' })).toEqual({
      gateStatus: 'RENDERED',
      overridden: false,
      outputs: [{ file: 'a.mp4', width: null, height: null }]
    });
    expect(deliverables('export_platform_versions', {}, { results: [{ output: '/x/PV/a - TikTok.mp4', info: { width: 1080, height: 1920 } }] })).toEqual({
      platformVersions: [{ file: 'a - TikTok.mp4', width: 1080, height: 1920 }]
    });
    expect(deliverables('build_short_sequences', {}, { built: [{ success: true, name: 'EP12 A' }, { success: false }] })).toEqual({ sequencesBuilt: 1, sequenceNames: ['EP12 A'] });
    expect(deliverables('get_project_info', {}, {})).toBeNull();
  });
});

describe('buildWeeklyReport', () => {
  function seeded(): string {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'bx-week-')), 't.sqlite');
    const store = new TelemetryDatabase(file);
    expect(store.open()).toBe(true);
    const t = Date.UTC(2026, 9, 6, 15);
    const db = (store as any).db;
    db.prepare("insert into sessions (session_id, project_name, workflow_type, started_at, started_ms, human_active_ms, automated_processing_ms) values ('s1','Shorts Batch','podcast_short','x',?,600000,1200000)").run(t);
    db.prepare("insert into sessions (session_id, project_name, workflow_type, started_at, started_ms) values ('s2','(unattributed)','unattributed','x',?)").run(t);
    const op = db.prepare('insert into operations (operation_id, session_id, name, category, started_ms, success, error_message, metadata) values (?,?,?,?,?,?,?,?)');
    op.run('o1', 's1', 'export_with_gate', 'export', t, 1, null, JSON.stringify({ outputs: [{ file: 'Short 01.mp4', width: 1080, height: 1920 }] }));
    op.run('o2', 's1', 'export_sequence', 'export', t, 1, null, JSON.stringify({ outputs: [{ file: 'Episode.mp4', width: 1920, height: 1080 }, { file: 'Short 01.mp4', width: 1080, height: 1920 }] }));
    op.run('o3', 's1', 'build_short_sequences', 'edit', t, 1, null, JSON.stringify({ sequencesBuilt: 3 }));
    op.run('o4', 's1', 'import_media', 'project', t, 0, 'File not found', null);
    op.run('o5', 's1', 'import_media', 'project', t, 0, 'File not found', null);
    op.run('o6', 's1', 'import_media', 'project', t, 1, null, null);
    op.run('o7', 's1', 'export_sequence', 'export', Date.UTC(2026, 8, 1), 1, null, JSON.stringify({ outputs: [{ file: 'old.mp4', width: 1080, height: 1920 }] }));
    db.prepare("insert into stages (session_id, stage, started_ms, ended_ms, duration_ms) values ('s1','captions',?,?,300000)").run(t, t + 300000);
    db.prepare("insert into qa_runs (session_id, ran_at_ms, duration_ms, final_status) values ('s1',?,10,'BLOCKED')").run(t);
    db.prepare("insert into qa_checks (session_id, name, passed, detail, recorded_ms) values ('s1','export gate override',0,'client deadline | blockers: x',?)").run(t);
    store.flush?.();
    store.close?.();
    return file;
  }

  it('counts distinct vertical shorts in the window and reports the rest', () => {
    const db = openReadOnly(seeded());
    const r = buildWeeklyReport(db, weekWindow('2026-10-07'));
    db.close();
    expect(r.shorts.vertical).toEqual(['Short 01.mp4']);
    expect(r.shorts.landscape).toEqual(['Episode.mp4']);
    expect(r.shorts.sequencesBuilt).toBe(3);
    expect(r.sessions).toMatchObject({ total: 2, projects: ['Shorts Batch'], unattributed: 1, humanMs: 600000 });
    expect(r.stages).toEqual([{ stage: 'captions', runs: 1, totalMs: 300000, avgMs: 300000 }]);
    expect(r.failingTools).toEqual([{ tool: 'import_media', failed: 2, calls: 3, rate: 67, topError: 'File not found' }]);
    expect(r.qa.byStatus).toEqual({ BLOCKED: 1 });
    expect(r.qa.overrides[0]!.detail).toMatch(/client deadline/);
    expect(r.gaps).toEqual([]);
    const text = renderWeeklyReport(r);
    expect(text).toMatch(/1 vertical short exported: Short 01\.mp4/);
    expect(text).toMatch(/import_media\s+2\/3 failed \(67%\)/);
  });

  it('says what is missing for an empty week', () => {
    const db = openReadOnly(seeded());
    const r = buildWeeklyReport(db, weekWindow('2026-12-01'));
    db.close();
    expect(r.gaps.join(' ')).toMatch(/No telemetry sessions/);
    expect(renderWeeklyReport(r)).toMatch(/MISSING DATA/);
  });
});
