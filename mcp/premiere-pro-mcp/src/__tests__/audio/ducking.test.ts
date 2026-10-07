/**
 * Ducking: speech spans, the keyframe curve, the Premiere level scale, and
 * mapping sequence time onto a music clip.
 */

import type { TimedWord } from '../../edit/cleanup.js';
import { dbToPremiereLevel, duckKeys, keysForClip, premiereLevelToDb, speechSpans } from '../../audio/ducking.js';

const w = (text: string, start: number, end: number): TimedWord => ({ text, start, end });

describe('speechSpans', () => {
  it('joins words across short gaps and splits at long ones', () => {
    const spans = speechSpans([w('a', 1, 1.3), w('b', 1.5, 1.9), w('c', 2.5, 2.8), w('d', 5, 5.4)], 0.8);
    expect(spans).toEqual([{ start: 1, end: 2.8 }, { start: 5, end: 5.4 }]);
  });
});

describe('duckKeys', () => {
  it('fades down before speech and back up after it', () => {
    expect(duckKeys([{ start: 2, end: 4 }])).toEqual([
      { time: 1.85, db: -18 },
      { time: 2, db: -30 },
      { time: 4, db: -30 },
      { time: 4.4, db: -18 }
    ]);
  });

  it('merges spans whose fades would overlap, so the bed never blips up', () => {
    const keys = duckKeys([{ start: 2, end: 4 }, { start: 4.4, end: 6 }]);
    expect(keys.filter((k) => k.db === -18)).toHaveLength(2);
    expect(keys[keys.length - 1]).toEqual({ time: 6.4, db: -18 });
  });

  it('starts ducked when speech starts at 0', () => {
    expect(duckKeys([{ start: 0, end: 1 }])[0]).toEqual({ time: 0, db: -30 });
  });
});

describe('Premiere level scale', () => {
  it('puts unity at 0.17783 (+15 dB is 1.0)', () => {
    expect(dbToPremiereLevel(0)).toBeCloseTo(0.17783, 5);
    expect(dbToPremiereLevel(15)).toBeCloseTo(1, 6);
    expect(premiereLevelToDb(dbToPremiereLevel(-18))).toBeCloseTo(-18, 6);
  });
});

describe('keysForClip', () => {
  it('maps sequence time into the clip media time and adds edge keys at the right level', () => {
    const keys = duckKeys([{ start: 12, end: 14 }]); // 11.85 bed, 12 duck, 14 duck, 14.4 bed
    // Clip sits at sequence 10..20 and starts 5s into its media.
    const clip = keysForClip(keys, { start: 10, end: 20, inPoint: 5 }, -18);
    expect(clip[0]).toEqual({ time: 5, db: -18 });
    expect(clip[1]).toEqual({ time: 6.85, db: -18 });
    expect(clip[2]).toEqual({ time: 7, db: -30 });
    expect(clip[clip.length - 1]).toEqual({ time: 15, db: -18 });
  });

  it('starts mid-duck at the ducked level when the clip begins during speech', () => {
    const keys = duckKeys([{ start: 2, end: 8 }]);
    const clip = keysForClip(keys, { start: 5, end: 7, inPoint: 0 }, -18);
    expect(clip[0]).toEqual({ time: 0, db: -30 });
    expect(clip[clip.length - 1]).toEqual({ time: 2, db: -30 });
  });
});
