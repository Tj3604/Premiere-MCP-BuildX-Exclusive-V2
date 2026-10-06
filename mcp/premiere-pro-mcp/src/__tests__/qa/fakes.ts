/**
 * Test doubles for the QA layer.
 *
 * The fake Premiere reader is stateful: an auto-fix that writes a parameter or
 * moves a clip actually changes what the next read returns. Without that, a test
 * of "re-run after auto-fix" would only prove the fix was called, not that it
 * worked.
 */

import type {
  ClipTailItem,
  ExtendClipTailOptions,
  ExtendClipTailResult,
  MediaProbe,
  MediaStreamInfo,
  MoveClipOptions,
  MoveClipResult,
  MovedTrackItem,
  PremiereReader,
  SequenceInfo,
  TimelineTracks
} from '../../qa/types.js';

export interface FakeState {
  sequence: SequenceInfo | null;
  tracks: TimelineTracks | null;
  params: Map<string, number | number[]>;
  projectName: string | null;
  activeSequenceId: string | null;
  /** Linked track items, keyed by clip id — e.g. a video clip and its audio. */
  links?: Record<string, string[]>;
  /** Source media behind each track item, keyed by clip id. */
  sources?: Record<string, { mediaPath: string; inPoint: number; outPoint: number }>;
}

export class FakePremiereReader implements PremiereReader {
  readonly calls: string[] = [];
  /** Set to make a specific call fail, simulating a dead bridge. */
  failOn = new Set<string>();
  /** When true, move_clip reports success but changes nothing. */
  moveClipSilentlyFails = false;
  /**
   * When true, move_clip moves only the target clip yet still reports its linked
   * items as moved — the A/V desync seen live before linked moves existed.
   */
  moveClipLeavesLinkedBehind = false;
  /** When true, extend_clip_tail reports success but changes nothing. */
  extendClipTailSilentlyFails = false;
  /** Arguments of every moveClip call, for asserting what the fix asked for. */
  readonly moveCalls: Array<{ clipId: string; newTimeSeconds: number; options: MoveClipOptions }> = [];

  constructor(public state: FakeState) {}

  private key(clipId: string, componentName: string, paramName: string): string {
    return `${clipId}::${componentName}::${paramName}`;
  }

  async getSequenceSettings(sequenceId: string): Promise<SequenceInfo | null> {
    this.calls.push('getSequenceSettings');
    if (this.failOn.has('getSequenceSettings')) return null;
    return this.state.sequence ? { ...this.state.sequence, sequenceId } : null;
  }

  async listSequenceTracks(_sequenceId: string): Promise<TimelineTracks | null> {
    this.calls.push('listSequenceTracks');
    if (this.failOn.has('listSequenceTracks')) return null;
    if (!this.state.tracks) return null;
    // Deep copy, so a check cannot mutate shared state by accident.
    return JSON.parse(JSON.stringify(this.state.tracks)) as TimelineTracks;
  }

  async getActiveSequenceId(): Promise<string | null> {
    return this.state.activeSequenceId;
  }

  async getProjectName(): Promise<string | null> {
    return this.state.projectName;
  }

  async getParamValue(
    clipId: string,
    componentName: string,
    paramName: string
  ): Promise<number | number[] | null> {
    this.calls.push('getParamValue');
    if (this.failOn.has('getParamValue')) return null;
    const value = this.state.params.get(this.key(clipId, componentName, paramName));
    return value === undefined ? null : value;
  }

  async setParamValue(
    clipId: string,
    componentName: string,
    paramName: string,
    value: number | number[]
  ): Promise<{ success: boolean; actual?: number | number[]; error?: string }> {
    this.calls.push('setParamValue');
    if (this.failOn.has('setParamValue')) return { success: false, error: 'bridge offline' };
    this.state.params.set(this.key(clipId, componentName, paramName), value);
    return { success: true, actual: value };
  }

  async exportFrame(): Promise<boolean> {
    this.calls.push('exportFrame');
    return !this.failOn.has('exportFrame');
  }

  async moveClip(clipId: string, newTimeSeconds: number, options: MoveClipOptions = {}): Promise<MoveClipResult> {
    this.calls.push('moveClip');
    this.moveCalls.push({ clipId, newTimeSeconds, options });
    if (this.failOn.has('moveClip')) return { success: false, error: 'bridge offline' };
    if (this.moveClipSilentlyFails) return { success: true };

    const locate = (id: string) => {
      for (const trackType of ['video', 'audio'] as const) {
        const list = trackType === 'video' ? this.state.tracks?.videoTracks : this.state.tracks?.audioTracks;
        for (const track of list ?? []) {
          const clip = track.clips.find((candidate) => candidate.id === id);
          if (clip) return { clip, trackType, trackIndex: track.index };
        }
      }
      return null;
    };

    const target = locate(clipId);
    if (!target) return { success: false, error: 'Clip not found' };
    const shift = newTimeSeconds - target.clip.startTime;
    const ids = [clipId, ...(options.includeLinked === false ? [] : this.state.links?.[clipId] ?? [])];

    const moved: MovedTrackItem[] = [];
    ids.forEach((id, position) => {
      const found = locate(id);
      if (!found) return;
      const oldTime = found.clip.startTime;
      const actuallyMoves = position === 0 || !this.moveClipLeavesLinkedBehind;
      if (actuallyMoves) {
        found.clip.startTime += shift;
        found.clip.endTime += shift;
      }
      moved.push({
        clipId: id,
        name: found.clip.name,
        trackType: found.trackType,
        trackIndex: found.trackIndex,
        oldTime,
        newTime: oldTime + shift
      });
    });
    return { success: true, shiftSeconds: shift, moved };
  }

  async extendClipTail(
    clipId: string,
    frames: number,
    options: ExtendClipTailOptions = {}
  ): Promise<ExtendClipTailResult> {
    this.calls.push(options.dryRun ? 'extendClipTail:dry' : 'extendClipTail');
    if (this.failOn.has('extendClipTail')) return { success: false, error: 'bridge offline' };
    const frame = frames / (this.state.sequence?.fps ?? 30);

    const locate = (id: string) => {
      for (const trackType of ['video', 'audio'] as const) {
        const list = trackType === 'video' ? this.state.tracks?.videoTracks : this.state.tracks?.audioTracks;
        for (const track of list ?? []) {
          const clip = track.clips.find((candidate) => candidate.id === id);
          if (clip) return { clip, track, trackType };
        }
      }
      return null;
    };
    const target = locate(clipId);
    if (!target) return { success: false, error: 'Clip not found' };
    const ids = [clipId, ...(options.includeLinked === false ? [] : this.state.links?.[clipId] ?? [])];
    const found = ids.map(locate).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const describe = (entry: (typeof found)[number]): ClipTailItem => {
      const source = this.state.sources?.[entry.clip.id];
      const mediaPath = source?.mediaPath ?? '';
      return {
        clipId: entry.clip.id,
        name: entry.clip.name,
        trackType: entry.trackType,
        trackIndex: entry.track.index,
        mediaPath,
        isStill: /\.(png|jpe?g)$/i.test(mediaPath),
        inPoint: source?.inPoint ?? 0,
        outPoint: source?.outPoint ?? entry.clip.duration,
        startTime: entry.clip.startTime,
        endTime: entry.clip.endTime
      };
    };
    const items = found.map(describe);
    if (options.dryRun) return { success: true, items };
    if (this.extendClipTailSilentlyFails) return { success: true, items, after: items };

    const problems: string[] = [];
    for (const [i, entry] of found.entries()) {
      const item = items[i]!;
      if (item.isStill) problems.push(`${item.name} is a still`);
      const limit = options.maxOutPointSeconds?.[item.trackType];
      if (typeof limit === 'number' && item.outPoint + frame > limit + 0.0005) problems.push(`${item.name} has no handle`);
      const blocked = entry.track.clips.some(
        (other) => other.id !== entry.clip.id && other.startTime < entry.clip.endTime + frame - 1e-9 && other.endTime > entry.clip.endTime
      );
      if (blocked) problems.push(`${item.name} would run into another clip`);
    }
    if (problems.length > 0) return { success: false, error: problems.join('; '), items };

    for (const entry of found) {
      entry.clip.endTime += frame;
      entry.clip.duration += frame;
      const source = this.state.sources?.[entry.clip.id];
      if (source) source.outPoint += frame;
    }
    return { success: true, items, after: found.map(describe) };
  }
}

export interface FakeMediaFile {
  sizeBytes: number;
  info: MediaStreamInfo;
  blackIntervals?: Array<{ start: number; end: number; duration: number }>;
  audio?: { meanDb: number; maxDb: number };
  frameLuma?: number;
}

export class FakeMediaProbe implements MediaProbe {
  constructor(public files: Map<string, FakeMediaFile> = new Map()) {}

  exists(filePath: string): boolean {
    return this.files.has(filePath) || [...this.files.keys()].some((key) => filePath.startsWith(key));
  }

  sizeBytes(filePath: string): number {
    return this.files.get(filePath)?.sizeBytes ?? 0;
  }

  async probe(filePath: string): Promise<MediaStreamInfo | null> {
    return this.files.get(filePath)?.info ?? null;
  }

  async detectBlackFrames(filePath: string): Promise<Array<{ start: number; end: number; duration: number }>> {
    return this.files.get(filePath)?.blackIntervals ?? [];
  }

  async measureAudio(filePath: string): Promise<{ meanDb: number; maxDb: number } | null> {
    return this.files.get(filePath)?.audio ?? null;
  }

  async extractFrame(filePath: string, _timeSeconds: number, outputPath: string): Promise<string | null> {
    if (!this.files.has(filePath)) return null;
    this.files.set(outputPath, this.files.get(filePath)!);
    return outputPath;
  }

  async meanLuma(imagePath: string): Promise<number | null> {
    return this.files.get(imagePath)?.frameLuma ?? 120;
  }
}

/** A clean 1080x1920 / 29.97 short: logo on V3, end card last, audio present. */
export function healthyProject(): FakeState {
  return {
    activeSequenceId: 'seq-1',
    projectName: 'X1234 (surname)',
    sequence: {
      name: '01-clean-short',
      sequenceId: 'seq-1',
      width: 1080,
      height: 1920,
      timebase: 8475667200, // 29.97
      fps: 254016000000 / 8475667200
    },
    tracks: {
      videoTracks: [
        {
          index: 0,
          name: 'V1',
          clipCount: 2,
          clips: [
            { id: 'clip-a', name: 'A001.MP4', startTime: 0, endTime: 12, duration: 12 },
            { id: 'clip-b', name: 'A002.MP4', startTime: 12, endTime: 25, duration: 13 }
          ]
        },
        {
          index: 1,
          name: 'V2',
          clipCount: 1,
          clips: [{ id: 'clip-cta', name: 'CTA Graphics 9x16.mp4', startTime: 25, endTime: 30, duration: 5 }]
        },
        {
          index: 2,
          name: 'V3',
          clipCount: 1,
          clips: [{ id: 'clip-logo', name: 'BuildX Logo WHITE.PNG.png', startTime: 0, endTime: 25, duration: 25 }]
        }
      ],
      audioTracks: [
        {
          index: 0,
          name: 'A1',
          clipCount: 2,
          clips: [
            { id: 'aud-a', name: 'A001.MP4', startTime: 0, endTime: 12, duration: 12 },
            { id: 'aud-b', name: 'A002.MP4', startTime: 12, endTime: 25, duration: 13 }
          ]
        }
      ]
    },
    params: new Map<string, number | number[]>([
      ['clip-logo::Motion::Position', [0.5, 0.153]],
      ['clip-logo::Motion::Scale', 40]
    ]),
    links: {
      'clip-a': ['aud-a'],
      'aud-a': ['clip-a'],
      'clip-b': ['aud-b'],
      'aud-b': ['clip-b']
    },
    sources: {
      'clip-a': { mediaPath: '/media/A001.MP4', inPoint: 0, outPoint: 12 },
      'aud-a': { mediaPath: '/media/A001.MP4', inPoint: 0, outPoint: 12 },
      'clip-b': { mediaPath: '/media/A002.MP4', inPoint: 0, outPoint: 13 },
      'aud-b': { mediaPath: '/media/A002.MP4', inPoint: 0, outPoint: 13 }
    }
  };
}

/**
 * The controlled defective project from the QA brief, carrying five intentional
 * faults at once:
 *
 *   1. wrong sequence resolution (1920x1080 for a vertical workflow)
 *   2. a one-frame timeline gap
 *   3. no logo clip anywhere
 *   4. no end card
 *   5. a logo placed outside the safe zone — supplied separately by
 *      `logoOutsideSafeZone()`, since defect 3 removes the logo entirely
 */
export function defectiveProject(): FakeState {
  const fps = 254016000000 / 8475667200;
  const oneFrame = 1 / fps;
  return {
    activeSequenceId: 'seq-bad',
    projectName: 'X9999 (defective)',
    sequence: {
      name: '99-defective',
      sequenceId: 'seq-bad',
      width: 1920,
      height: 1080,
      timebase: 8475667200,
      fps
    },
    tracks: {
      videoTracks: [
        {
          index: 0,
          name: 'V1',
          clipCount: 2,
          clips: [
            { id: 'clip-a', name: 'A001.MP4', startTime: 0, endTime: 12, duration: 12 },
            // One frame later than it should be: the frame-maths gap.
            { id: 'clip-b', name: 'A002.MP4', startTime: 12 + oneFrame, endTime: 25, duration: 13 - oneFrame }
          ]
        }
      ],
      audioTracks: [
        {
          index: 0,
          name: 'A1',
          clipCount: 1,
          clips: [{ id: 'aud-a', name: 'A001.MP4', startTime: 0, endTime: 25, duration: 25 }]
        }
      ]
    },
    params: new Map<string, number | number[]>(),
    sources: {
      'clip-a': { mediaPath: '/media/A001.MP4', inPoint: 0, outPoint: 12 },
      'clip-b': { mediaPath: '/media/A002.MP4', inPoint: 0, outPoint: 13 - oneFrame }
    }
  };
}

/** A correct-format project whose logo sits above the title-safe line. */
export function logoOutsideSafeZone(): FakeState {
  const state = healthyProject();
  // The superseded value: top edge lands at -31px, cropped off frame entirely.
  state.params.set('clip-logo::Motion::Position', [0.5, 0.0385417]);
  state.params.set('clip-logo::Motion::Scale', 54);
  return state;
}

/** A project with a one-frame gap and everything else correct. */
export function oneFrameGapProject(): FakeState {
  const state = healthyProject();
  const fps = state.sequence!.fps;
  // The clip and its linked audio both start a frame late, as they do in Premiere.
  state.tracks!.videoTracks[0]!.clips[1]!.startTime = 12 + 1 / fps;
  state.tracks!.audioTracks[0]!.clips[1]!.startTime = 12 + 1 / fps;
  return state;
}

/**
 * Two one-frame gaps on one track, the live 2026-10-06 shape: three clips each a
 * frame short, so closing the first gap moves the edge the second gap is
 * measured from.
 */
export function twoGapProject(): FakeState {
  const state = healthyProject();
  const frame = 1 / state.sequence!.fps;
  const clipLength = 8 - frame; // a frame short of the 8s slot each clip sits in
  const at = (slot: number) => ({ startTime: slot * 8, endTime: slot * 8 + clipLength, duration: clipLength });
  state.tracks!.videoTracks[0]!.clips = [
    { id: 'clip-a', name: 'A001.MP4', ...at(0) },
    { id: 'clip-b', name: 'A002.MP4', ...at(1) },
    { id: 'clip-c', name: 'A003.MP4', ...at(2) }
  ];
  state.tracks!.videoTracks[0]!.clipCount = 3;
  state.tracks!.audioTracks[0]!.clips = [
    { id: 'aud-a', name: 'A001.MP4', ...at(0) },
    { id: 'aud-b', name: 'A002.MP4', ...at(1) },
    { id: 'aud-c', name: 'A003.MP4', ...at(2) }
  ];
  state.tracks!.audioTracks[0]!.clipCount = 3;
  state.links = {
    'clip-a': ['aud-a'],
    'clip-b': ['aud-b'],
    'clip-c': ['aud-c']
  };
  state.sources = {};
  for (const letter of ['a', 'b', 'c']) {
    const mediaPath = `/media/${letter.toUpperCase()}.MP4`;
    state.sources[`clip-${letter}`] = { mediaPath, inPoint: 0, outPoint: clipLength };
    state.sources[`aud-${letter}`] = { mediaPath, inPoint: 0, outPoint: clipLength };
  }
  // End card and logo follow the last clip, so only the gaps are wrong.
  const end = 16 + clipLength;
  state.tracks!.videoTracks[1]!.clips[0] = { id: 'clip-cta', name: 'CTA Graphics 9x16.mp4', startTime: end, endTime: end + 5, duration: 5 };
  state.tracks!.videoTracks[2]!.clips[0] = { id: 'clip-logo', name: 'BuildX Logo WHITE.PNG.png', startTime: 0, endTime: end, duration: end };
  return state;
}

/**
 * A one-frame gap before a clip that nothing else lines up with: the second clip
 * ends well before the end card, so moving it back is safe.
 */
export function trailingGapProject(): FakeState {
  const state = healthyProject();
  const frame = 1 / state.sequence!.fps;
  const v = state.tracks!.videoTracks[0]!.clips;
  const a = state.tracks!.audioTracks[0]!.clips;
  v[1] = { id: 'clip-b', name: 'A002.MP4', startTime: 12 + frame, endTime: 20 + frame, duration: 8 };
  a[1] = { id: 'aud-b', name: 'A002.MP4', startTime: 12 + frame, endTime: 20 + frame, duration: 8 };
  return state;
}

/**
 * Media for every source a fake state references, each `durationSeconds` long
 * per stream. Pass the clip's own length to model media with no handle.
 */
export function mediaFor(state: FakeState, durationSeconds = 60): FakeMediaProbe {
  const files = new Map<string, FakeMediaFile>();
  for (const source of Object.values(state.sources ?? {})) {
    files.set(source.mediaPath, {
      sizeBytes: 1,
      info: {
        width: 1080,
        height: 1920,
        durationSeconds,
        videoDurationSeconds: durationSeconds,
        audioDurationSeconds: durationSeconds,
        hasAudio: true,
        hasVideo: true,
        frameRate: state.sequence?.fps ?? null,
        sizeBytes: 1
      }
    });
  }
  return new FakeMediaProbe(files);
}
