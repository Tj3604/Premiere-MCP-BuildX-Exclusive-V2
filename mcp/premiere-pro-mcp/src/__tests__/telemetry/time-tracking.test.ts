/**
 * Active vs automated time: the 10-minute rule, gap attribution, stage mapping,
 * timers, revisions after export, human activity, and overlap handling.
 */

import { computeTime, stageForTimer, stageForTool, type TimeInputs } from '../../telemetry/time-tracking.js';

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 5, 13, 0); // Monday
const at = (m: number) => T0 + m * MIN;
const call = (videoId: string | null, name: string, startMin: number, secs = 2) => ({ videoId, name, startedMs: at(startMin), endedMs: at(startMin) + secs * 1000 });
const inputs = (over: Partial<TimeInputs>): TimeInputs => ({ calls: [], timers: [], human: [], exportedMs: {}, ...over });
const week = [T0, T0 + 7 * 24 * 60 * MIN] as const;
const mins = (ms: number | undefined) => Math.round(((ms ?? 0) / MIN) * 10) / 10;

describe('stage mapping', () => {
  it('maps tools to the seven stages and leaves reads neutral', () => {
    expect(stageForTool('import_media')).toBe('transcribe');
    expect(stageForTool('add_to_timeline_batch')).toBe('rough-cut');
    expect(stageForTool('razor_timeline_at_time')).toBe('rough-cut');
    expect(stageForTool('place_captions')).toBe('captions');
    expect(stageForTool('set_clip_position')).toBe('graphics');
    expect(stageForTool('apply_ducking')).toBe('audio');
    expect(stageForTool('export_with_gate')).toBe('qa-export');
    expect(stageForTool('get_project_info')).toBeNull();
    expect(stageForTool('undo')).toBeNull();
  });

  it('maps workflow timers', () => {
    expect(stageForTimer('transcription')).toBe('transcribe');
    expect(stageForTimer('timeline_build')).toBe('rough-cut');
    expect(stageForTimer('export')).toBe('qa-export');
    expect(stageForTimer('captions')).toBe('captions');
  });
});

describe('computeTime', () => {
  it('counts gaps under 10 minutes as active and longer ones as idle; tool time is automated', () => {
    const r = computeTime(inputs({ calls: [call('v1', 'import_media', 0, 30), call('v1', 'add_to_timeline', 5, 3), call('v1', 'razor_all_tracks', 30, 1)] }), ...week);
    // 0:30 -> 5:00 is active (4.5 min); 5:03 -> 30:00 is idle.
    expect(mins(r.videos.v1!.activeMs)).toBe(4.5);
    expect(r.videos.v1!.automatedMs).toBe(34000);
    expect(mins(r.videos.v1!.stages['rough-cut'])).toBe(4.5);
  });

  it('gives the gap to the video and stage of the call it leads to, and tracks untagged time', () => {
    const r = computeTime(
      inputs({ calls: [call(null, 'get_project_info', 0, 0), call('v1', 'make_captions', 2, 0), call('v2', 'apply_ducking', 5, 0), call(null, 'list_sequences', 6, 0)] }),
      ...week
    );
    expect(mins(r.videos.v1!.stages.captions)).toBe(2);
    expect(mins(r.videos.v2!.stages.audio)).toBe(3);
    expect(mins(r.untrackedActiveMs)).toBe(1);
  });

  it('gives neutral tools the stage of the previous call on that video', () => {
    const r = computeTime(inputs({ calls: [call('v1', 'make_captions', 0, 0), call('v1', 'get_clip_properties', 3, 0)] }), ...week);
    expect(mins(r.videos.v1!.stages.captions)).toBe(3);
  });

  it('counts work after the first export as revisions, except more QA/export', () => {
    const r = computeTime(
      inputs({
        calls: [call('v1', 'export_platform_versions', 0, 0), call('v1', 'trim_clip', 4, 0), call('v1', 'export_with_gate', 6, 0)],
        exportedMs: { v1: at(0) + 1 }
      }),
      ...week
    );
    expect(mins(r.videos.v1!.stages.revisions)).toBe(4);
    expect(mins(r.videos.v1!.stages['qa-export'])).toBe(2);
  });

  it('counts an empty timer as active, and lets a timer with calls only label them', () => {
    const r = computeTime(
      inputs({
        calls: [call('v1', 'get_project_info', 30, 0), call('v1', 'get_clip_properties', 33, 0)],
        timers: [
          { videoId: 'v1', name: 'transcription', startedMs: at(0), endedMs: at(20) },
          { videoId: 'v1', name: 'graphics', startedMs: at(29), endedMs: at(40) }
        ]
      }),
      ...week
    );
    expect(mins(r.videos.v1!.stages.transcribe)).toBe(20);
    expect(mins(r.videos.v1!.stages.graphics)).toBe(3);
  });

  it('counts marked human activity once, even where it overlaps counted gaps', () => {
    const r = computeTime(
      inputs({ calls: [call('v1', 'add_to_timeline', 0, 0), call('v1', 'trim_clip', 5, 0)], human: [{ startedMs: at(3), endedMs: at(25) }] }),
      ...week
    );
    // Gap 0->5 (5 min) + human 3->25 overlapping 3->5: 25 min in total, not 27.
    expect(mins(r.videos.v1!.activeMs)).toBe(25);
  });

  it('only counts calls inside the window, but measures the first gap from just before it', () => {
    const r = computeTime(inputs({ calls: [call('v1', 'add_to_timeline', -3, 0), call('v1', 'trim_clip', 2, 0)] }), ...week);
    expect(mins(r.videos.v1!.activeMs)).toBe(2);
    expect(r.videos.v1!.automatedMs).toBe(0);
  });
});
