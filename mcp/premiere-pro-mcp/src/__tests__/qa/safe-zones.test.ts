/**
 * Safe-zone geometry: zone judgement, Motion mapping, cell-level judgement, the
 * approved logo exception, and pixel occupancy.
 */

import { captionBox, judgeBox, judgeCells, toFrame } from '../../qa/safe-zones.js';
import { visibleFromRgba } from '../../qa/visible-box.js';
import { isApprovedLogo } from '../../qa/zone-tool.js';

describe('judgeBox', () => {
  it('passes a box inside x108-972 × y192-1728', () => {
    expect(judgeBox({ x0: 108, y0: 724, x1: 720, y1: 880 }).verdict).toBe('pass');
  });

  it('warns on the side edge bands only', () => {
    const r = judgeBox({ x0: 60, y0: 600, x1: 500, y1: 700 });
    expect(r.verdict).toBe('warn');
    expect(r.platforms.every((p) => p.zones.some((z) => /left edge/.test(z)))).toBe(true);
  });

  it('fails the top title band and the bottom controls band', () => {
    expect(judgeBox({ x0: 300, y0: 150, x1: 700, y1: 300 }).verdict).toBe('fail');
    expect(judgeBox({ x0: 300, y0: 1600, x1: 700, y1: 1760 }).verdict).toBe('fail');
  });

  it('fails Reels-only zones for Reels alone', () => {
    const header = judgeBox({ x0: 300, y0: 220, x1: 700, y1: 300 });
    expect(header.platforms.find((p) => p.platform === 'shorts')!.verdict).toBe('pass');
    expect(header.platforms.find((p) => p.platform === 'reels')!.zones.join()).toMatch(/Reels header/);
    const rail = judgeBox({ x0: 900, y0: 1400, x1: 960, y1: 1440 });
    expect(rail.platforms.find((p) => p.platform === 'reels')!.zones.join()).toMatch(/action rail/);
    expect(rail.platforms.find((p) => p.platform === 'tiktok')!.verdict).toBe('pass');
  });

  it('scales to other 9:16 sizes', () => {
    expect(judgeBox({ x0: 172.8, y0: 640, x1: 1555, y1: 2176 }, 1728, 3072).verdict).toBe("pass");
    expect(judgeBox({ x0: 172.8, y0: 640, x1: 1600, y1: 2176 }, 1728, 3072).verdict).toBe("warn");
  });
});

describe('judgeCells', () => {
  it('does not merge a top-right header and a bottom button into one rail hit', () => {
    const header = { x0: 800, y0: 270, x1: 970, y1: 300 };
    const button = { x0: 165, y0: 1272, x1: 915, y1: 1396 };
    expect(judgeBox({ x0: 165, y0: 270, x1: 970, y1: 1396 }).platforms.find((p) => p.platform === 'reels')!.verdict).toBe('fail');
    expect(judgeCells([header, button]).verdict).toBe('pass');
  });
});

describe('toFrame', () => {
  it('places media through Position, Scale and a centre anchor', () => {
    // A 1000x400 logo at scale 31 centred on (858, 308) in 1080x1920.
    const b = toFrame({ x0: 0, y0: 0, x1: 1000, y1: 400 }, 1000, 400, { position: [858 / 1080, 308 / 1920], scale: 31 }, 1080, 1920);
    expect(b.x0).toBeCloseTo(703);
    expect(b.x1).toBeCloseTo(1013);
    expect(b.y0).toBeCloseTo(246);
    expect(b.y1).toBeCloseTo(370);
  });

  it('is the identity for a full-frame overlay at 100%', () => {
    expect(toFrame({ x0: 10, y0: 20, x1: 30, y1: 40 }, 1080, 1920, { position: [0.5, 0.5], scale: 100 }, 1080, 1920)).toEqual({ x0: 10, y0: 20, x1: 30, y1: 40 });
  });
});

describe('isApprovedLogo', () => {
  it('accepts only the standard upper-right logo', () => {
    expect(isApprovedLogo('BuildX Logo.mov', { position: [0.79444, 0.16042], scale: 31 }, 1080, 1920)).toBe(true);
    expect(isApprovedLogo('BuildX Logo.mov', { position: [0.75, 0.12], scale: 31 }, 1080, 1920)).toBe(false);
    expect(isApprovedLogo('Lower Third.mov', { position: [0.79444, 0.16042], scale: 31 }, 1080, 1920)).toBe(false);
  });
});

describe('captionBox', () => {
  it('centres the measured line at the caption height', () => {
    expect(captionBox(745)).toEqual({ x0: 167.5, x1: 912.5, y0: 909, y1: 1009 });
    expect(judgeBox(captionBox(745)).verdict).toBe('pass');
    expect(judgeBox(captionBox(900)).verdict).toBe('warn');
  });
});

describe('visibleFromRgba', () => {
  function frame(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): Buffer {
    const b = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(fill(x, y), (y * w + x) * 4);
    return b;
  }

  it('finds opaque pixels in an alpha overlay', () => {
    const buf = frame(40, 40, (x, y) => (x >= 10 && x < 20 && y >= 6 && y < 12 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    expect(visibleFromRgba(buf, 40, 40, true, 1).box).toEqual({ x0: 10, y0: 6, x1: 20, y1: 12 });
  });

  it('treats an alpha file with an opaque background as a card, measuring what differs from it', () => {
    const buf = frame(40, 40, (x, y) => (x >= 30 && y >= 30 ? [255, 184, 28, 255] : [11, 11, 12, 255]));
    expect(visibleFromRgba(buf, 40, 40, true, 1).box).toEqual({ x0: 30, y0: 30, x1: 40, y1: 40 });
  });
});
