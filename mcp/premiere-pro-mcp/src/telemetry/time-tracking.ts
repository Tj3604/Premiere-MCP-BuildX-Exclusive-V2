/**
 * Active vs automated time per video and stage, computed from what telemetry
 * already records (video_activity from T1, plus human_activity). Nothing new is
 * recorded here.
 *
 * - Automated: how long the MCP spent running each tool call.
 * - Active (the editor's time): the gap before each tool call when it is under
 *   10 minutes; a longer gap is idle. The gap belongs to the video and stage of
 *   the call it leads to.
 * - A stage timer with no tool calls inside it (e.g. transcribing in the terminal)
 *   counts its whole length as active; a timer with calls inside only labels them.
 * - Marked human activity (start/stop_human_activity) counts as active — pure
 *   hand-editing in Premiere makes no MCP calls and would otherwise look idle.
 * Overlapping active spans are counted once.
 */

export const TIME_STAGES = ['transcribe', 'rough-cut', 'captions', 'graphics', 'audio', 'qa-export', 'revisions'] as const;
export type TimeStage = (typeof TIME_STAGES)[number];

export const ACTIVE_GAP_MS = 10 * 60 * 1000;

const EXACT: Record<string, TimeStage> = {};
const add = (stage: TimeStage, names: string[]) => names.forEach((n) => (EXACT[n] = stage));

add('transcribe', ['relink_media', 'manage_proxies', 'detect_silence', 'scene_edit_detection', 'detect_scene_edits', 'find_similar_videos', 'refresh_media']);
add('rough-cut', [
  'set_source_in_out', 'insert_from_source', 'overwrite_from_source', 'split_clip', 'trim_clip', 'ripple_delete', 'roll_edit',
  'slip_edit', 'slide_edit', 'extend_clip_tail', 'remove_from_timeline', 'lift_selection', 'extract_selection', 'create_subsequence',
  'duplicate_sequence', 'nest_clips', 'unnest_sequence', 'speed_change', 'set_clip_speed_qe', 'freeze_frame', 'reverse_clip',
  'auto_reframe_sequence', 'find_cuts', 'find_short_candidates', 'build_short_sequences', 'suggest_punch_ins', 'apply_punch_ins',
  'suggest_broll', 'overwrite_clip', 'replace_clip', 'replace_clip_media', 'duplicate_clip', 'create_subclip', 'match_frame',
  'link_audio_video', 'link_selection', 'unlink_selection', 'remove_selected_clips', 'set_clip_start_time', 'set_work_area'
]);
add('captions', ['make_captions', 'place_captions', 'create_caption_track', 'read_sequence_captions']);
add('graphics', [
  'add_text_overlay', 'get_mogrt_component', 'add_adjustment_layer', 'apply_effect', 'batch_apply_effect', 'apply_lut', 'color_correct',
  'set_param_value', 'add_keyframe', 'remove_keyframe', 'remove_keyframe_range', 'set_keyframe_interpolation', 'set_clip_anchor_point',
  'set_blend_mode', 'crop_clip', 'stabilize_clip', 'build_motion_graphics_demo', 'copy_effect_values', 'copy_effects_between_clips',
  'remove_effect', 'remove_effect_by_name', 'remove_all_effects', 'set_effect_property', 'set_color_value', 'set_uniform_scale',
  'set_scale_to_frame_size', 'set_scale_width_height', 'build_brand_spot_from_mogrt_and_assets', 'assemble_product_spot'
]);
add('audio', [
  'adjust_audio_levels', 'add_audio_keyframes', 'apply_audio_effect', 'apply_audio_effect_to_all_clips', 'set_clip_volume', 'set_clip_pan',
  'mute_track', 'setup_ducking', 'plan_ducking', 'apply_ducking', 'measure_loudness', 'normalize_loudness', 'set_sequence_audio_settings'
]);
add('qa-export', [
  'run_buildx_qa', 'run_technical_qa', 'run_visual_qa', 'apply_safe_qa_fixes', 'rerun_failed_qa_checks', 'get_qa_failures',
  'get_last_qa_report', 'check_safe_zones', 'compress_export', 'add_to_render_queue', 'start_batch_encode', 'get_render_queue_status',
  'pick_cover_frames', 'upload_metadata_brief', 'save_upload_metadata', 'check_hook', 'list_hooks', 'capture_frame', 'check_offline_media'
]);

const PATTERNS: Array<[RegExp, TimeStage]> = [
  [/^import_/, 'transcribe'],
  [/^(add_to_timeline|razor_|move_clip|create_sequence|set_sequence_|add_marker|update_marker|delete_marker)/, 'rough-cut'],
  [/^(import_mogrt|set_clip_(position|scale|rotation|opacity)|add_transition|batch_add_transitions)/, 'graphics'],
  [/^(export_|encode_)/, 'qa-export']
];

/** The stage a tool belongs to, or null for neutral tools (reads, selection, save, undo). */
export function stageForTool(name: string): TimeStage | null {
  if (EXACT[name]) return EXACT[name]!;
  for (const [re, stage] of PATTERNS) if (re.test(name)) return stage;
  return null;
}

/** Workflow stage timers (start_workflow_stage) mapped onto the time-log stages. */
export function stageForTimer(name: string): TimeStage {
  const n = name.toLowerCase().replace(/[\s_]+/g, '-');
  if ((TIME_STAGES as readonly string[]).includes(n)) return n as TimeStage;
  if (n === 'transcription' || n === 'analysis') return 'transcribe';
  if (n === 'cut-planning' || n === 'timeline-build') return 'rough-cut';
  if (n === 'qa' || n === 'export') return 'qa-export';
  if (n === 'graphics') return 'graphics';
  return 'rough-cut';
}

export interface ToolCall {
  videoId: string | null;
  name: string;
  startedMs: number;
  endedMs: number;
}

export interface Span {
  videoId: string | null;
  name: string;
  startedMs: number;
  endedMs: number;
}

export interface TimeInputs {
  calls: ToolCall[];
  /** Finished stage timers (video_activity kind 'stage'). */
  timers: Span[];
  /** Marked human activity; videoId is resolved from the calls around it. */
  human: Array<{ startedMs: number; endedMs: number }>;
  /** First export time per video, for revisions. */
  exportedMs: Record<string, number | null>;
}

export interface VideoTime {
  activeMs: number;
  automatedMs: number;
  stages: Partial<Record<TimeStage, number>>;
}

export interface TimeTotals {
  /** Keyed by video id; untracked time sits under the null key ''. */
  videos: Record<string, VideoTime>;
  untrackedActiveMs: number;
}

interface Segment {
  videoId: string | null;
  stage: TimeStage;
  start: number;
  end: number;
}

const key = (id: string | null) => id ?? '';

/**
 * Computes active and automated time per video and stage for calls/spans that
 * start inside [fromMs, toMs). Calls just before the window are used only to
 * measure the first gap; pass them in too.
 */
export function computeTime(inputs: TimeInputs, fromMs: number, toMs: number, activeGapMs = ACTIVE_GAP_MS): TimeTotals {
  const calls = [...inputs.calls].sort((a, b) => a.startedMs - b.startedMs);
  const timers = [...inputs.timers].sort((a, b) => a.startedMs - b.startedMs);
  const inWindow = (t: number) => t >= fromMs && t < toMs;

  const lastStage = new Map<string, TimeStage>();
  const stageOf = (c: ToolCall): TimeStage => {
    const exported = c.videoId ? inputs.exportedMs[c.videoId] ?? null : null;
    const timer = timers.find((t) => key(t.videoId) === key(c.videoId) && c.startedMs >= t.startedMs && c.startedMs < t.endedMs);
    let stage: TimeStage | null = timer ? stageForTimer(timer.name) : stageForTool(c.name);
    if (stage) lastStage.set(key(c.videoId), stage);
    else stage = lastStage.get(key(c.videoId)) ?? 'rough-cut';
    if (exported !== null && c.startedMs > exported && stage !== 'qa-export') return 'revisions';
    return stage;
  };

  const out: TimeTotals = { videos: {}, untrackedActiveMs: 0 };
  const bucket = (id: string | null) => (out.videos[key(id)] ??= { activeMs: 0, automatedMs: 0, stages: {} });
  const segments: Segment[] = [];

  let prev: ToolCall | null = null;
  const stagesByCall = new Map<ToolCall, TimeStage>();
  for (const c of calls) {
    const stage = stageOf(c);
    stagesByCall.set(c, stage);
    if (inWindow(c.startedMs)) {
      bucket(c.videoId).automatedMs += Math.max(0, c.endedMs - c.startedMs);
      if (prev) {
        const gap = c.startedMs - prev.endedMs;
        if (gap > 0 && gap < activeGapMs) segments.push({ videoId: c.videoId, stage, start: Math.max(prev.endedMs, fromMs), end: c.startedMs });
      }
    }
    prev = c;
  }

  // Timers nothing ran inside: the work happened outside the MCP.
  for (const t of timers) {
    if (!inWindow(t.startedMs)) continue;
    const empty = !calls.some((c) => key(c.videoId) === key(t.videoId) && c.startedMs >= t.startedMs && c.startedMs < t.endedMs);
    if (empty) segments.push({ videoId: t.videoId, stage: stageForTimer(t.name), start: t.startedMs, end: Math.min(t.endedMs, toMs) });
  }

  // Marked human activity: the video and stage of the last call before it.
  for (const h of inputs.human) {
    if (!inWindow(h.startedMs)) continue;
    const before = [...calls].reverse().find((c) => c.startedMs <= h.startedMs);
    const videoId = before?.videoId ?? null;
    const stage = before ? stagesByCall.get(before)! : 'rough-cut';
    segments.push({ videoId, stage, start: h.startedMs, end: Math.min(h.endedMs, toMs) });
  }

  // Count overlapping spans once: earlier-starting span keeps the overlap.
  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  let covered = -Infinity;
  for (const s of segments) {
    const start = Math.max(s.start, covered);
    if (s.end <= start) continue;
    const ms = s.end - start;
    covered = Math.max(covered, s.end);
    if (s.videoId === null) {
      out.untrackedActiveMs += ms;
      continue;
    }
    const b = bucket(s.videoId);
    b.activeMs += ms;
    b.stages[s.stage] = (b.stages[s.stage] ?? 0) + ms;
  }
  // Untracked calls have no video entry; their automated time is not reported.
  delete out.videos[''];
  return out;
}

/** Anything that can run a read query (TelemetryDatabase.query or a read-only DatabaseSync wrapper). */
export type QueryFn = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => T[];

/** Reads the inputs for [fromMs, toMs) — calls from 10 minutes earlier so the first gap is measured. */
export function loadTimeInputs(query: QueryFn, fromMs: number, toMs: number): TimeInputs {
  const calls = query<{ video_id: string | null; name: string; started_ms: number; ended_ms: number }>(
    "SELECT video_id, name, started_ms, ended_ms FROM video_activity WHERE kind = 'tool' AND started_ms >= ? AND started_ms < ? ORDER BY started_ms",
    [fromMs - ACTIVE_GAP_MS, toMs]
  ).map((r) => ({ videoId: r.video_id, name: r.name, startedMs: r.started_ms, endedMs: r.ended_ms }));
  const timers = query<{ video_id: string | null; name: string; started_ms: number; ended_ms: number }>(
    "SELECT video_id, name, started_ms, ended_ms FROM video_activity WHERE kind = 'stage' AND started_ms < ? AND ended_ms > ?",
    [toMs, fromMs - ACTIVE_GAP_MS]
  ).map((r) => ({ videoId: r.video_id, name: r.name, startedMs: r.started_ms, endedMs: r.ended_ms }));
  const human = query<{ started_ms: number; ended_ms: number | null }>(
    'SELECT started_ms, ended_ms FROM human_activity WHERE started_ms >= ? AND started_ms < ? AND ended_ms IS NOT NULL',
    [fromMs, toMs]
  ).map((r) => ({ startedMs: r.started_ms, endedMs: r.ended_ms! }));
  const exportedMs: Record<string, number | null> = {};
  for (const v of query<{ id: string; exported_ms: number | null }>('SELECT id, exported_ms FROM videos')) exportedMs[v.id] = v.exported_ms;
  return { calls, timers, human, exportedMs };
}
