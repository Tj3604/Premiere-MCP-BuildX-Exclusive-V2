/**
 * The Content Desk time log: the exact format (a contract), the week maths, the
 * folder, the safe write, and the automatic rewrites.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Telemetry } from '../../telemetry/telemetry.js';
import { executeTelemetryTool } from '../../telemetry/tools.js';
import { timeLogDir, weekOf, writeTimeLog, type TimeLog } from '../../telemetry/time-log.js';

const MIN = 60000;
// Wednesday 2026-10-07 10:00 local time.
const WED = new Date(2026, 9, 7, 10, 0, 0).getTime();

function setup(start = WED) {
  let t = start;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-timelog-'));
  const telemetry = new Telemetry({ env: {}, now: clock.now, config: { enabled: true, databasePath: path.join(dir, 't.sqlite'), autoSession: true, hourlyLaborCost: null } });
  const call = (name: string, ms: number, result: unknown = { success: true }) =>
    telemetry.instrumentToolCall(name, async () => {
      clock.advance(ms);
      return result;
    });
  return { telemetry, clock, call, logDir: path.join(dir, 'logs') };
}

/** Exactly the format the Content Desk reads. */
function assertTimeLogFormat(log: any): void {
  const isMin = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && Math.abs(Math.round(n * 10) - n * 10) < 1e-9;
  const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  expect(Object.keys(log).sort()).toEqual(['generatedAt', 'kind', 'untrackedActiveMin', 'version', 'videos', 'weekEnd', 'weekStart'].sort());
  expect(log.kind).toBe('buildx-time-log');
  expect(log.version).toBe(1);
  expect(isDate(log.weekStart)).toBe(true);
  expect(isDate(log.weekEnd)).toBe(true);
  expect(new Date(log.generatedAt).toISOString()).toBe(log.generatedAt);
  expect(isMin(log.untrackedActiveMin)).toBe(true);
  expect(Array.isArray(log.videos)).toBe(true);
  for (const v of log.videos) {
    const keys = ['activeMin', 'automatedMin', 'id', 'stages', 'status', 'title', 'type'];
    expect(Object.keys(v).sort()).toEqual((v.status === 'exported' ? [...keys, 'exportedOn'] : keys).sort());
    expect(typeof v.id).toBe('string');
    expect(typeof v.title).toBe('string');
    expect(['short', 'podcast', 'longform', 'ad', 'testimonial', 'other']).toContain(v.type);
    expect(['exported', 'in-progress']).toContain(v.status);
    if (v.status === 'exported') expect(isDate(v.exportedOn)).toBe(true);
    expect(isMin(v.activeMin)).toBe(true);
    expect(isMin(v.automatedMin)).toBe(true);
    for (const [stage, m] of Object.entries(v.stages)) {
      expect(['transcribe', 'rough-cut', 'captions', 'graphics', 'audio', 'qa-export', 'revisions']).toContain(stage);
      expect(isMin(m)).toBe(true);
    }
    const sum = Object.values(v.stages as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBe(v.activeMin);
  }
}

describe('weekOf', () => {
  it('is Monday to Sunday in local time, moving any day back to its Monday', () => {
    expect(weekOf(undefined, WED)).toMatchObject({ weekStart: '2026-10-05', weekEnd: '2026-10-11' });
    expect(weekOf('2026-10-11', WED)).toMatchObject({ weekStart: '2026-10-05', weekEnd: '2026-10-11' });
    expect(weekOf('2026-10-12', WED).weekStart).toBe('2026-10-12');
    expect(() => weekOf('10/5/2026', WED)).toThrow(/YYYY-MM-DD/);
    expect(() => weekOf('2026-02-30', WED)).toThrow(/Not a real date/);
  });
});

describe('timeLogDir', () => {
  it('uses BUILDX_TIME_LOG_DIR, expands ~, and defaults to ~/Claude Video Editor/time-logs', () => {
    expect(timeLogDir({})).toBe(path.join(os.homedir(), 'Claude Video Editor', 'time-logs'));
    expect(timeLogDir({ BUILDX_TIME_LOG_DIR: '~/logs' })).toBe(path.join(os.homedir(), 'logs'));
    expect(timeLogDir({ BUILDX_TIME_LOG_DIR: '/tmp/x' })).toBe('/tmp/x');
  });
});

describe('the time log', () => {
  const saved = { dir: process.env.BUILDX_TIME_LOG_DIR, auto: process.env.BUILDX_TIME_LOG_AUTO };
  afterEach(() => {
    process.env.BUILDX_TIME_LOG_DIR = saved.dir;
    process.env.BUILDX_TIME_LOG_AUTO = saved.auto;
    if (saved.dir === undefined) delete process.env.BUILDX_TIME_LOG_DIR;
  });

  it('matches the Content Desk format exactly', async () => {
    const { telemetry, clock, call, logDir } = setup();
    process.env.BUILDX_TIME_LOG_DIR = logDir;
    await call('get_project_info', 500); // no video yet
    clock.advance(1.5 * MIN);
    await call('list_sequences', 500); // its 1.5-minute lead-in is untracked
    clock.advance(2 * MIN);
    telemetry.setCurrentVideo('x1460-s07', 'The Living Room', 'short');
    await call('import_media', 3000);
    clock.advance(4 * MIN);
    await call('add_to_timeline', 1200);
    clock.advance(3 * MIN + 20000);
    await call('make_captions', 800);
    clock.advance(2 * MIN);
    await call('export_platform_versions', 20000);
    telemetry.setCurrentVideo('ep12', 'Episode 12', 'podcast');
    clock.advance(5 * MIN);
    await call('find_short_candidates', 4000);

    const out = telemetry.exportTimeLog()!;
    const onDisk = JSON.parse(fs.readFileSync(out.path, 'utf8'));
    assertTimeLogFormat(onDisk);
    expect(out.path).toBe(path.join(logDir, 'buildx-time-2026-10-05.json'));
    expect(onDisk).toMatchObject({ weekStart: '2026-10-05', weekEnd: '2026-10-11', untrackedActiveMin: 1.5 });
    const [short, podcast] = [onDisk.videos.find((v: any) => v.id === 'x1460-s07'), onDisk.videos.find((v: any) => v.id === 'ep12')];
    // The 2 minutes after set_current_video lead to import_media, so they are the short's transcribe time.
    expect(short).toMatchObject({ title: 'The Living Room', type: 'short', status: 'exported', exportedOn: '2026-10-07', activeMin: 11.3 });
    expect(short.stages).toEqual({ transcribe: 2, 'rough-cut': 4, captions: 3.3, 'qa-export': 2 });
    expect(podcast).toMatchObject({ type: 'podcast', status: 'in-progress', activeMin: 5, automatedMin: 0.1 });
    expect(podcast).not.toHaveProperty('exportedOn');
  });

  it('writes through the tool and replaces the week file whole', async () => {
    const { telemetry, call, logDir } = setup();
    process.env.BUILDX_TIME_LOG_DIR = logDir;
    telemetry.setCurrentVideo('v1', 'V', 'ad');
    await call('import_media', 100);
    const file = writeTimeLog(telemetry.exportTimeLog()!.log, logDir);
    expect(fs.readdirSync(logDir)).toEqual(['buildx-time-2026-10-05.json']);
    assertTimeLogFormat(JSON.parse(fs.readFileSync(file, 'utf8')) as TimeLog);
    const viaTool = await Promise.resolve(executeTelemetryTool('export_time_log', { weekStart: '2026-10-09' }));
    expect(viaTool.success).toBe(true);
  });

  it('rewrites the current week by itself: on export, at session end, and every 15 minutes while active', async () => {
    const { telemetry, clock, call, logDir } = setup();
    process.env.BUILDX_TIME_LOG_DIR = logDir;
    process.env.BUILDX_TIME_LOG_AUTO = '1';
    const file = path.join(logDir, 'buildx-time-2026-10-05.json');
    const stamp = () => JSON.parse(fs.readFileSync(file, 'utf8')).generatedAt;

    telemetry.setCurrentVideo('v1', 'V', 'short');
    await call('import_media', 100); // first activity writes the file
    const first = stamp();
    clock.advance(2 * MIN);
    await call('add_to_timeline', 100); // under 15 minutes since the last write: no rewrite
    expect(stamp()).toBe(first);

    clock.advance(5 * MIN);
    await call('export_platform_versions', 100); // export: rewrite
    const afterExport = stamp();
    expect(afterExport).not.toBe(first);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).videos[0].status).toBe('exported');

    for (let i = 0; i < 4; i++) {
      clock.advance(5 * MIN);
      await call('trim_clip', 100);
    }
    const whileActive = stamp(); // 15+ minutes of activity since the export write
    expect(whileActive).not.toBe(afterExport);

    clock.advance(MIN);
    telemetry.endSession('success');
    expect(stamp()).not.toBe(whileActive);
    (telemetry as any).timeLogTimer && clearInterval((telemetry as any).timeLogTimer);
  });
});
