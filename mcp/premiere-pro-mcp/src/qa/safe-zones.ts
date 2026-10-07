/**
 * 9:16 safe-zone map and the box-against-zone judgement.
 *
 * Values (1080x1920 reference, scaled to any 9:16 frame):
 * - Safe area x108–972 × y192–1728: knowledge/buildx/safe-zones.md, "Working values
 *   for BuildX 9:16" (TikTok row; the same working values are used for Shorts).
 * - Reels additionally: Instagram's transparent rect x52–1027 × y247–1453 and the
 *   action rail biting x>932 below y1380 — measured from the Guideify overlay for the
 *   standard end card (graphics-template/cta notes).
 * - The approved shorts logo (upper-right, scale 31) is the one placement allowed past
 *   the 972 line (config.ts SHORTS_LOGO_PLACEMENT).
 *
 * Inside the safe area = pass. In the frame but past a side line = warn (edge band:
 * may be cropped on some devices). In a platform UI zone = fail.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Platform = 'shorts' | 'tiktok' | 'reels';
export type Verdict = 'pass' | 'warn' | 'fail';

export interface ZoneHit {
  platform: Platform;
  verdict: Verdict;
  zones: string[];
}

export interface ZoneResult {
  verdict: Verdict;
  box: Box;
  platforms: ZoneHit[];
}

const REF_W = 1080;
const REF_H = 1920;

const SAFE = { x0: 108, x1: 972, y0: 192, y1: 1728 };
const REELS_RECT = { x0: 52, x1: 1027, y0: 247, y1: 1453 };
const REELS_RAIL = { x0: 932, y0: 1380 };

function worst(a: Verdict, b: Verdict): Verdict {
  const rank = { pass: 0, warn: 1, fail: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/** Judges a box in frame pixels against each platform's zones. */
export function judgeBox(box: Box, frameWidth = REF_W, frameHeight = REF_H, platforms: Platform[] = ['shorts', 'tiktok', 'reels']): ZoneResult {
  // Work in the 1080x1920 reference so every 9:16 size uses the same numbers.
  const sx = REF_W / frameWidth;
  const sy = REF_H / frameHeight;
  const b = { x0: box.x0 * sx, x1: box.x1 * sx, y0: box.y0 * sy, y1: box.y1 * sy };
  const hits: ZoneHit[] = [];
  for (const platform of platforms) {
    const zones: string[] = [];
    let verdict: Verdict = 'pass';
    if (b.y0 < SAFE.y0) { zones.push(`top title band (above y${SAFE.y0})`); verdict = 'fail'; }
    if (b.y1 > SAFE.y1) { zones.push(`bottom controls band (below y${SAFE.y1})`); verdict = 'fail'; }
    if (b.x0 < 0 || b.x1 > REF_W || b.y0 < 0 || b.y1 > REF_H) { zones.push('off the frame'); verdict = 'fail'; }
    if (b.x0 < SAFE.x0) { zones.push(`left edge band (x<${SAFE.x0})`); verdict = worst(verdict, 'warn'); }
    if (b.x1 > SAFE.x1) { zones.push(`right edge band (x>${SAFE.x1})`); verdict = worst(verdict, 'warn'); }
    if (platform === 'reels') {
      if (b.y0 < REELS_RECT.y0) { zones.push(`Reels header (above y${REELS_RECT.y0})`); verdict = 'fail'; }
      if (b.y1 > REELS_RECT.y1) { zones.push(`Reels caption/username block (below y${REELS_RECT.y1})`); verdict = 'fail'; }
      if (b.x1 > REELS_RAIL.x0 && b.y1 > REELS_RAIL.y0) { zones.push(`Reels action rail (x>${REELS_RAIL.x0}, y>${REELS_RAIL.y0})`); verdict = 'fail'; }
    }
    hits.push({ platform, verdict, zones });
  }
  return { verdict: hits.reduce<Verdict>((v, h) => worst(v, h.verdict), 'pass'), box, platforms: hits };
}

export interface Motion {
  /** Normalised [x, y] — where the anchor sits in the frame. */
  position: [number, number];
  /** Percent. */
  scale: number;
  /** Normalised anchor within the media, default centre. */
  anchor?: [number, number];
}

/**
 * Maps a box in media pixels to frame pixels through Motion. Premiere places the
 * media's anchor at position × frame size and scales about it.
 */
export function toFrame(mediaBox: Box, mediaWidth: number, mediaHeight: number, motion: Motion, frameWidth: number, frameHeight: number): Box {
  const s = motion.scale / 100;
  const [ax, ay] = motion.anchor ?? [0.5, 0.5];
  const px = motion.position[0] * frameWidth;
  const py = motion.position[1] * frameHeight;
  const ox = ax * mediaWidth;
  const oy = ay * mediaHeight;
  return {
    x0: px + (mediaBox.x0 - ox) * s,
    x1: px + (mediaBox.x1 - ox) * s,
    y0: py + (mediaBox.y0 - oy) * s,
    y1: py + (mediaBox.y1 - oy) * s
  };
}

/** A caption line: measured width, centred, at the Thomas Default height. */
export function captionBox(widthPx: number, frameWidth = REF_W, topY = 909, lineHeightPx = 100): Box {
  const x0 = (frameWidth - widthPx) / 2;
  return { x0, x1: x0 + widthPx, y0: topY, y1: topY + lineHeightPx };
}

export function roundBox(b: Box): Box {
  return { x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) };
}

/**
 * Judges the actual visible pixels (as occupancy cells) rather than one bounding box:
 * a header top-right and a button bottom-centre are not one block in the action rail.
 * The reported box is the union, the zones are the union of each cell's zones.
 */
export function judgeCells(cells: Box[], frameWidth = REF_W, frameHeight = REF_H, platforms: Platform[] = ['shorts', 'tiktok', 'reels']): ZoneResult {
  const union: Box = cells.reduce(
    (u, c) => ({ x0: Math.min(u.x0, c.x0), y0: Math.min(u.y0, c.y0), x1: Math.max(u.x1, c.x1), y1: Math.max(u.y1, c.y1) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  );
  const per = new Map<Platform, { verdict: Verdict; zones: Set<string> }>(platforms.map((p) => [p, { verdict: 'pass' as Verdict, zones: new Set<string>() }]));
  for (const cell of cells) {
    for (const hit of judgeBox(cell, frameWidth, frameHeight, platforms).platforms) {
      const agg = per.get(hit.platform)!;
      agg.verdict = worst(agg.verdict, hit.verdict);
      for (const zn of hit.zones) agg.zones.add(zn);
    }
  }
  const hits: ZoneHit[] = platforms.map((p) => ({ platform: p, verdict: per.get(p)!.verdict, zones: [...per.get(p)!.zones] }));
  return { verdict: hits.reduce<Verdict>((v, h) => worst(v, h.verdict), 'pass'), box: union, platforms: hits };
}
