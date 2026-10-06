/**
 * Safe-zone geometry.
 *
 * Values come from knowledge/buildx/safe-zones.md, which is marked authoritative
 * and dated 2026-08-11. Nothing here is invented: where that document records an
 * arithmetic inconsistency in its own source graphic, the conservative reading it
 * prescribes is the one implemented.
 *
 * Premiere's Motion > Position is the clip's CENTRE point, normalised against the
 * sequence frame. Scale is a percentage of the source asset's native size. Both
 * conventions are load-bearing here — see the derivation in safe-zones.md, where
 * position [0.5, 0.1530] at scale 40 on a 1000x389 asset puts the logo's top edge
 * at 216px in a 1920-tall frame.
 */

export interface SafeZoneInsets {
  /** Fraction of frame width inset from the left edge. */
  left: number;
  right: number;
  /** Fraction of frame height inset from the top edge. */
  top: number;
  bottom: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Per-aspect insets.
 *
 * 9:16 — TikTok column of safe-zones.md: 192px top and bottom on 1920 (10%),
 *        108px each side on 1080 (10%). The document notes the source graphic
 *        claims 100% usable width while also specifying a 108px edge safe;
 *        the conservative 864px reading is the one it instructs using.
 * 16:9 — YouTube column: 250px on all four sides of 1920x1080.
 * 4:5  — Instagram column: 135px top and bottom, 108px sides.
 */
export const SAFE_ZONE_PRESETS: Record<string, SafeZoneInsets> = {
  '9:16': { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 },
  '16:9': { left: 250 / 1920, right: 250 / 1920, top: 250 / 1080, bottom: 250 / 1080 },
  '4:5': { left: 108 / 1080, right: 108 / 1080, top: 135 / 1350, bottom: 135 / 1350 }
};

/** Nearest known aspect label for a frame size. */
export function aspectLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return 'unknown';
  const ratio = width / height;
  const candidates: Array<[string, number]> = [
    ['9:16', 9 / 16],
    ['4:5', 4 / 5],
    ['16:9', 16 / 9],
    ['1:1', 1]
  ];
  let best = candidates[0] as [string, number];
  let bestDelta = Math.abs(ratio - best[1]);
  for (const candidate of candidates.slice(1)) {
    const delta = Math.abs(ratio - candidate[1]);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return bestDelta / best[1] < 0.05 ? best[0] : 'unknown';
}

export function safeZoneFor(width: number, height: number, override?: SafeZoneInsets): Box {
  const insets = override ?? SAFE_ZONE_PRESETS[aspectLabel(width, height)] ?? SAFE_ZONE_PRESETS['9:16'];
  const resolved = insets as SafeZoneInsets;
  return {
    left: width * resolved.left,
    top: height * resolved.top,
    right: width * (1 - resolved.right),
    bottom: height * (1 - resolved.bottom)
  };
}

/**
 * Rendered bounding box of a clip, given Premiere's normalised centre position
 * and percentage scale against a known native asset size.
 */
export function boxForPlacement(params: {
  frameWidth: number;
  frameHeight: number;
  position: [number, number];
  scalePercent: number;
  assetWidth: number;
  assetHeight: number;
}): Box {
  const renderedWidth = params.assetWidth * (params.scalePercent / 100);
  const renderedHeight = params.assetHeight * (params.scalePercent / 100);
  const centreX = params.position[0] * params.frameWidth;
  const centreY = params.position[1] * params.frameHeight;
  return {
    left: centreX - renderedWidth / 2,
    top: centreY - renderedHeight / 2,
    right: centreX + renderedWidth / 2,
    bottom: centreY + renderedHeight / 2
  };
}

export interface SafeZoneViolation {
  edge: 'left' | 'right' | 'top' | 'bottom';
  overflowPx: number;
}

/**
 * Overflow below this is not reported. Half a pixel is finer than the thing being
 * measured, and without it floating-point noise reads as a safe-zone breach.
 */
export const SAFE_ZONE_TOLERANCE_PX = 0.5;

/** Every edge on which `box` falls outside `safeZone`, with the overflow in px. */
export function safeZoneViolations(
  box: Box,
  safeZone: Box,
  tolerancePx = SAFE_ZONE_TOLERANCE_PX
): SafeZoneViolation[] {
  const violations: SafeZoneViolation[] = [];
  const round = (value: number) => Math.round(value * 10) / 10;
  const over = (amount: number) => amount > tolerancePx;

  if (over(safeZone.left - box.left)) {
    violations.push({ edge: 'left', overflowPx: round(safeZone.left - box.left) });
  }
  if (over(safeZone.top - box.top)) {
    violations.push({ edge: 'top', overflowPx: round(safeZone.top - box.top) });
  }
  if (over(box.right - safeZone.right)) {
    violations.push({ edge: 'right', overflowPx: round(box.right - safeZone.right) });
  }
  if (over(box.bottom - safeZone.bottom)) {
    violations.push({ edge: 'bottom', overflowPx: round(box.bottom - safeZone.bottom) });
  }
  return violations;
}

export function describeViolations(element: string, violations: SafeZoneViolation[]): string {
  return violations
    .map((violation) => `${element} exceeds ${violation.edge} safe zone by ${violation.overflowPx}px`)
    .join('; ');
}

/**
 * Logo scale for a frame width, derived the way design-system.md prescribes:
 * 40 at 1080 wide, scaled linearly. Rounded to one decimal, which is the
 * precision Premiere's Scale field carries.
 */
export function deriveLogoScale(frameWidth: number, baseScale = 40, baseWidth = 1080): number {
  return Math.round(baseScale * (frameWidth / baseWidth) * 10) / 10;
}
