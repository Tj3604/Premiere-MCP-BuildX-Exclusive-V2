/**
 * Per-video tagging: current video, attribution of tool calls and stages,
 * restarts, the automatic export mark, and bad input.
 */

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Telemetry } from '../../telemetry/telemetry.js';
import { executeTelemetryTool } from '../../telemetry/tools.js';

function setup(file?: string) {
  let t = Date.UTC(2026, 9, 7, 13, 0, 0);
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const dbPath = file ?? path.join(mkdtempSync(path.join(os.tmpdir(), 'bx-video-')), 'telemetry.sqlite');
  const telemetry = new Telemetry({ env: {}, now: clock.now, config: { enabled: true, databasePath: dbPath, autoSession: true, hourlyLaborCost: null } });
  const rows = () => {
    telemetry.flush();
    return (telemetry as any).db.query('SELECT video_id, kind, name, duration_ms, success FROM video_activity ORDER BY id') as any[];
  };
  const call = (name: string, ms: number, result: unknown = { success: true }) =>
    telemetry.instrumentToolCall(name, async () => {
      clock.advance(ms);
      return result;
    });
  return { telemetry, clock, rows, call, dbPath };
}

describe('video tagging', () => {
  it('attributes tool calls to the current video, and to none before one is set', async () => {
    const { telemetry, rows, call } = setup();
    await call('get_project_info', 200);
    telemetry.setCurrentVideo('x1460-s07', 'The Living Room', 'short');
    await call('make_captions', 1500);
    telemetry.setCurrentVideo('ep12', 'Episode 12', 'podcast');
    await call('find_short_candidates', 900, { success: false, error: 'nope' });
    expect(rows()).toEqual([
      { video_id: null, kind: 'tool', name: 'get_project_info', duration_ms: 200, success: 1 },
      { video_id: 'x1460-s07', kind: 'tool', name: 'make_captions', duration_ms: 1500, success: 1 },
      { video_id: 'ep12', kind: 'tool', name: 'find_short_candidates', duration_ms: 900, success: 0 }
    ]);
  });

  it('records a finished stage against the current video', () => {
    const { telemetry, clock, rows } = setup();
    telemetry.setCurrentVideo('v1', 'V', 'longform');
    telemetry.startStage('captions');
    clock.advance(60000);
    telemetry.endStage('captions');
    expect(rows().filter((r) => r.kind === 'stage')).toEqual([{ video_id: 'v1', kind: 'stage', name: 'captions', duration_ms: 60000, success: null }]);
  });

  it('keeps the current video across a restart', () => {
    const first = setup();
    first.telemetry.setCurrentVideo('v1', 'Kept', 'ad');
    first.telemetry.flush();
    const second = setup(first.dbPath);
    expect(second.telemetry.getCurrentVideo()).toMatchObject({ id: 'v1', title: 'Kept', type: 'ad' });
  });

  it('marks the current video exported when a platform export succeeds, not when it fails', async () => {
    const { telemetry, call } = setup();
    telemetry.setCurrentVideo('v1', 'V', 'short');
    await call('export_platform_versions', 5000, { success: false, error: 'not 9:16' });
    expect(telemetry.getCurrentVideo()!.exportedMs).toBeNull();
    await call('export_platform_versions', 5000, { success: true });
    expect(telemetry.getCurrentVideo()!.exportedMs).toEqual(expect.any(Number));
  });

  it('updates title and type when an id is reused, and marks by id', () => {
    const { telemetry } = setup();
    telemetry.setCurrentVideo('v1', 'Old', 'short');
    const v = telemetry.setCurrentVideo('v1', 'New', 'testimonial')!;
    expect(v).toMatchObject({ title: 'New', type: 'testimonial' });
    expect(telemetry.markVideoExported('v1')!.exportedMs).toEqual(expect.any(Number));
    expect(() => telemetry.markVideoExported('missing')).toThrow(/No video "missing"/);
  });

  it('rejects an unknown type', () => {
    const { telemetry } = setup();
    expect(() => telemetry.setCurrentVideo('v1', 'V', 'vlog' as any)).toThrow(/short, podcast, longform, ad, testimonial, other/);
  });
});

describe('video tools', () => {
  it('validate the type and report the current video', async () => {
    const bad = await Promise.resolve(executeTelemetryTool('set_current_video', { id: 'v', title: 'T', type: 'vlog' }));
    expect(bad.success).toBe(false);
    const current = await Promise.resolve(executeTelemetryTool('get_current_video', {}));
    expect(current.success).toBe(true);
  });
});
