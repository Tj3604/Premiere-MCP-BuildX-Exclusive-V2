/**
 * Where a graphic's visible pixels actually are. An overlay MOV is a full-frame
 * canvas, so its layer size says nothing — sample a few frames and take the union
 * of the pixels that show: alpha above a threshold, or, for an opaque file,
 * pixels that differ from its corner (background) colour.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Box } from './safe-zones.js';

const run = promisify(execFile);

export interface MediaInfo {
  width: number;
  height: number;
  duration: number | null;
  alpha: boolean;
}

export async function probeMedia(file: string): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt:format=duration', '-of', 'json', file
  ]);
  const j = JSON.parse(stdout);
  const s = j.streams?.[0];
  if (!s) throw new Error(`No video stream in ${file}`);
  const pix = String(s.pix_fmt ?? '');
  const d = Number(j.format?.duration);
  return {
    width: s.width,
    height: s.height,
    duration: Number.isFinite(d) && d > 0 ? d : null,
    alpha: /yuva|rgba|argb|bgra|abgr|gbrap|ya8|ya16|pal8/.test(pix)
  };
}

async function frameRgba(file: string, at: number | null, width: number, height: number): Promise<Buffer> {
  const args = ['-v', 'error', '-nostdin'];
  if (at !== null) args.push('-ss', at.toFixed(3));
  args.push('-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
  const { stdout } = await run('ffmpeg', args, { encoding: 'buffer', maxBuffer: width * height * 4 + 1024 });
  return stdout as unknown as Buffer;
}

/** Cell size for the occupancy grid — fine enough to tell a button from a header. */
export const CELL = 8;

export interface Visible {
  box: Box | null;
  /** Occupied CELLxCELL cells by "cx,cy", each with the exact bounds of its visible pixels. */
  cells: Map<string, Box>;
}

export function boxFromRgba(buf: Buffer, width: number, height: number, alpha: boolean, step = 2): Box | null {
  return visibleFromRgba(buf, width, height, alpha, step).box;
}

export function visibleFromRgba(buf: Buffer, width: number, height: number, alpha: boolean, step = 2): Visible {
  const cells = new Map<string, Box>();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const bg = [buf[0]!, buf[1]!, buf[2]!];
  // An alpha file with an opaque corner is a full-frame card (e.g. the end card):
  // its content is what differs from the background, not what is opaque.
  if (alpha && buf[3]! > 16) alpha = false;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const on = alpha
        ? buf[i + 3]! > 16
        : Math.abs(buf[i]! - bg[0]!) + Math.abs(buf[i + 1]! - bg[1]!) + Math.abs(buf[i + 2]! - bg[2]!) > 60;
      if (!on) continue;
      const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      const c = cells.get(key);
      if (c) { c.x0 = Math.min(c.x0, x); c.y0 = Math.min(c.y0, y); c.x1 = Math.max(c.x1, x + 1); c.y1 = Math.max(c.y1, y + 1); }
      else cells.set(key, { x0: x, y0: y, x1: x + 1, y1: y + 1 });
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { box: x1 < 0 ? null : { x0, y0, x1: Math.min(width, x1 + step), y1: Math.min(height, y1 + step) }, cells };
}

/** Union of the visible box over `samples` frames spread across the clip. */
export async function visibleBox(file: string, samples = 5): Promise<{ info: MediaInfo; box: Box | null; cells: Box[]; sampledAt: number[] }> {
  const info = await probeMedia(file);
  const times = info.duration ? Array.from({ length: samples }, (_, k) => (info.duration! * (k + 1)) / (samples + 1)) : [null];
  let box: Box | null = null;
  const occupied = new Map<string, Box>();
  for (const t of times) {
    const v = visibleFromRgba(await frameRgba(file, t, info.width, info.height), info.width, info.height, info.alpha);
    for (const [k, c] of v.cells) {
      const o = occupied.get(k);
      occupied.set(k, o ? { x0: Math.min(o.x0, c.x0), y0: Math.min(o.y0, c.y0), x1: Math.max(o.x1, c.x1), y1: Math.max(o.y1, c.y1) } : { ...c });
    }
    const b = v.box;
    if (!b) continue;
    box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
  }
  const cells = [...occupied.values()];
  return { info, box, cells, sampledAt: times.filter((t): t is number => t !== null).map((t) => Math.round(t * 100) / 100) };
}
