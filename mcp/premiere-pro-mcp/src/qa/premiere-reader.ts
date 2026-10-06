/**
 * Premiere state reader.
 *
 * The only place QA talks to Premiere. Two rules it enforces on every call:
 *
 *  - A response carrying `accepted: true` is the expanded dispatcher's catch-all,
 *    which this repository has verified does nothing. It is treated as NO DATA,
 *    never as a result.
 *  - A tool that returns `success: false` yields null rather than a guess. A check
 *    that cannot read state reports ERROR; it never reports PASS.
 */

import { Logger } from '../utils/logger.js';
import { PREMIERE_TICKS_PER_SECOND } from './types.js';
import type {
  ClipTailItem,
  ExtendClipTailOptions,
  ExtendClipTailResult,
  MoveClipOptions,
  MoveClipResult,
  PremiereReader,
  SequenceInfo,
  TimelineTracks
} from './types.js';

export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<any>;

/** True when a payload is real data rather than a fake-success stub. */
export function isRealResponse(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const record = result as Record<string, unknown>;
  if (record.accepted === true) return false;
  return record.success !== false;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export class ToolPremiereReader implements PremiereReader {
  private readonly logger = new Logger('QA.PremiereReader');

  constructor(private readonly call: ToolCaller) {}

  private async safeCall(name: string, args: Record<string, unknown>): Promise<any | null> {
    try {
      const result = await this.call(name, args);
      if (!isRealResponse(result)) {
        this.logger.warn(`${name} returned no usable data (stub or failure)`);
        return null;
      }
      return result;
    } catch (error) {
      this.logger.warn(`${name} threw: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async getSequenceSettings(sequenceId: string): Promise<SequenceInfo | null> {
    const result = await this.safeCall('get_sequence_settings', { sequenceId });
    const settings = result?.settings;
    if (!settings) return null;

    const width = num(settings.width);
    const height = num(settings.height);
    const timebase = num(settings.timebase);
    if (width === null || height === null || timebase === null || timebase <= 0) return null;

    return {
      name: typeof settings.name === 'string' ? settings.name : '',
      sequenceId: String(settings.sequenceID ?? sequenceId),
      width,
      height,
      timebase,
      // get_full_sequence_info returns a stub and carries no frame rate; the
      // timebase from get_sequence_settings is the reliable source.
      fps: PREMIERE_TICKS_PER_SECOND / timebase
    };
  }

  async listSequenceTracks(sequenceId: string): Promise<TimelineTracks | null> {
    const result = await this.safeCall('list_sequence_tracks', { sequenceId });
    if (!result) return null;
    const videoTracks = Array.isArray(result.videoTracks) ? result.videoTracks : null;
    const audioTracks = Array.isArray(result.audioTracks) ? result.audioTracks : null;
    if (!videoTracks || !audioTracks) return null;

    const mapTrack = (track: any, index: number) => ({
      index: num(track?.index) ?? index,
      name: typeof track?.name === 'string' ? track.name : `Track ${index + 1}`,
      clipCount: num(track?.clipCount) ?? (Array.isArray(track?.clips) ? track.clips.length : 0),
      clips: (Array.isArray(track?.clips) ? track.clips : []).map((clip: any) => ({
        id: String(clip?.id ?? ''),
        name: typeof clip?.name === 'string' ? clip.name : '',
        startTime: num(clip?.startTime) ?? 0,
        endTime: num(clip?.endTime) ?? 0,
        duration: num(clip?.duration) ?? 0
      }))
    });

    return {
      videoTracks: videoTracks.map(mapTrack),
      audioTracks: audioTracks.map(mapTrack)
    };
  }

  async getActiveSequenceId(): Promise<string | null> {
    const result = await this.safeCall('get_active_sequence', {});
    const id = result?.sequence?.sequenceID ?? result?.sequenceId ?? result?.id;
    return id ? String(id) : null;
  }

  async getProjectName(): Promise<string | null> {
    const result = await this.safeCall('get_project_info', {});
    const name = result?.name ?? result?.project?.name ?? result?.projectName;
    return typeof name === 'string' ? name : null;
  }

  async getParamValue(
    clipId: string,
    componentName: string,
    paramName: string
  ): Promise<number | number[] | null> {
    const result = await this.safeCall('get_param_value', { clipId, componentName, paramName });
    const value = result?.value;
    if (typeof value === 'number') return value;
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) return value as number[];
    return null;
  }

  async setParamValue(
    clipId: string,
    componentName: string,
    paramName: string,
    value: number | number[]
  ): Promise<{ success: boolean; actual?: number | number[]; error?: string }> {
    try {
      const result = await this.call('set_param_value', { clipId, componentName, paramName, value });
      if (!isRealResponse(result)) {
        return { success: false, error: 'set_param_value returned no usable data' };
      }
      const actual = result?.actual;
      const out: { success: boolean; actual?: number | number[]; error?: string } = { success: true };
      if (typeof actual === 'number' || Array.isArray(actual)) out.actual = actual;
      return out;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async moveClip(clipId: string, newTimeSeconds: number, options: MoveClipOptions = {}): Promise<MoveClipResult> {
    try {
      const args: Record<string, unknown> = {
        clipId,
        newTime: newTimeSeconds,
        includeLinked: options.includeLinked ?? true
      };
      if (options.sequenceId) args.sequenceId = options.sequenceId;
      const result = await this.call('move_clip', args);
      if (!isRealResponse(result)) {
        const reason = typeof result?.error === 'string' ? result.error : 'move_clip returned no usable data';
        return { success: false, error: reason };
      }
      const out: MoveClipResult = { success: true };
      const shift = num(result.shiftSeconds);
      if (shift !== null) out.shiftSeconds = shift;
      if (Array.isArray(result.moved)) {
        out.moved = result.moved.map((item: any) => ({
          clipId: String(item?.clipId ?? ''),
          name: typeof item?.name === 'string' ? item.name : '',
          trackType: item?.trackType === 'audio' ? 'audio' : 'video',
          trackIndex: num(item?.trackIndex) ?? -1,
          oldTime: num(item?.oldTime) ?? 0,
          newTime: num(item?.newTime) ?? 0
        }));
      }
      return out;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async extendClipTail(
    clipId: string,
    frames: number,
    options: ExtendClipTailOptions = {}
  ): Promise<ExtendClipTailResult> {
    const mapItems = (list: unknown): ClipTailItem[] | undefined =>
      Array.isArray(list)
        ? list.map((item: any) => ({
            clipId: String(item?.clipId ?? ''),
            name: typeof item?.name === 'string' ? item.name : '',
            trackType: item?.trackType === 'audio' ? 'audio' : 'video',
            trackIndex: num(item?.trackIndex) ?? -1,
            mediaPath: typeof item?.mediaPath === 'string' ? item.mediaPath : '',
            isStill: item?.isStill === true,
            inPoint: num(item?.inPoint) ?? 0,
            outPoint: num(item?.outPoint) ?? 0,
            startTime: num(item?.startTime) ?? 0,
            endTime: num(item?.endTime) ?? 0
          }))
        : undefined;

    try {
      const args: Record<string, unknown> = {
        clipId,
        frames,
        includeLinked: options.includeLinked ?? true,
        dryRun: options.dryRun ?? false
      };
      if (options.sequenceId) args.sequenceId = options.sequenceId;
      if (options.maxOutPointSeconds) args.maxOutPointSeconds = options.maxOutPointSeconds;
      const result = await this.call('extend_clip_tail', args);
      const items = mapItems(result?.items);
      if (!isRealResponse(result)) {
        const out: ExtendClipTailResult = {
          success: false,
          error: typeof result?.error === 'string' ? result.error : 'extend_clip_tail returned no usable data'
        };
        if (items) out.items = items;
        return out;
      }
      const out: ExtendClipTailResult = { success: true };
      if (items) out.items = items;
      const after = mapItems(result.after);
      if (after) out.after = after;
      return out;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async exportFrame(sequenceId: string, timeSeconds: number, outputPath: string): Promise<boolean> {
    const result = await this.safeCall('export_frame', {
      sequenceId,
      time: timeSeconds,
      outputPath,
      format: 'png'
    });
    return result !== null;
  }
}
