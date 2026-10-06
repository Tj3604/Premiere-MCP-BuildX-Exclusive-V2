/**
 * Frame arithmetic.
 *
 * Frame rates are compared as integer timebases, never as floats: 29.97 is
 * 30000/1001, and a float comparison against 29.97 is a bug waiting for a
 * rounding error. Premiere expresses a sequence's rate as ticks per frame, so
 * the comparison happens in ticks.
 */

import { PREMIERE_TICKS_PER_SECOND } from './types.js';

export interface Rational {
  numerator: number;
  denominator: number;
}

/** Ticks per frame for a rational rate. 29.97 -> 8475667200. */
export function timebaseFor(fps: Rational): number {
  return Math.round((PREMIERE_TICKS_PER_SECOND * fps.denominator) / fps.numerator);
}

export function fpsFromTimebase(timebase: number): number {
  return timebase > 0 ? PREMIERE_TICKS_PER_SECOND / timebase : 0;
}

/** Exact rate comparison, done on integer timebases. */
export function timebaseMatches(actualTimebase: number, expected: Rational): boolean {
  return Math.round(actualTimebase) === timebaseFor(expected);
}

export function formatFps(fps: Rational): string {
  const value = fps.numerator / fps.denominator;
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Seconds to whole frames at a given rate, rounded to the nearest frame. */
export function secondsToFrames(seconds: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  return fps > 0 ? frames / fps : 0;
}

/**
 * HH:MM:SS:FF, non-drop. Premiere's own display format on this project is
 * Feet + Frames, which has burned time before; this renders unambiguous
 * timecode instead.
 */
export function formatTimecode(seconds: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.round(seconds * rate));
  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(
    totalSeconds % 60
  )}:${pad(frames)}`;
}
