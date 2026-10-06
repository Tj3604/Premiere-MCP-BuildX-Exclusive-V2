/**
 * Safe-zone repositioning.
 *
 * The correction applied is the SMALLEST translation that brings the element back
 * inside the safe zone. It deliberately does not snap the element to a canonical
 * position: the repository's documented logo placement (centred, 0.5 / 0.1530)
 * and a later recorded upper-right variant disagree, and a fix has no business
 * picking a side. Nudging the element just inside the line satisfies the
 * objective rule while preserving whatever placement intent was there.
 *
 * Scale is never changed. Shrinking an element to make it fit is a design
 * decision, not a repair.
 */

import { boxForPlacement, safeZoneFor, type Box } from '../geometry.js';

export interface RepositionInput {
  frameWidth: number;
  frameHeight: number;
  position: [number, number];
  scalePercent: number;
  assetWidth: number;
  assetHeight: number;
  safeZone?: Box;
}

export interface RepositionResult {
  position: [number, number];
  deltaPx: { x: number; y: number };
}

/**
 * Minimal nudge that puts the element inside the safe zone, or null when it
 * cannot fit at its current scale — that case is a human decision.
 */
export function computeMinimalReposition(input: RepositionInput): RepositionResult | null {
  const safeZone = input.safeZone ?? safeZoneFor(input.frameWidth, input.frameHeight);
  const box = boxForPlacement(input);

  const boxWidth = box.right - box.left;
  const boxHeight = box.bottom - box.top;
  const zoneWidth = safeZone.right - safeZone.left;
  const zoneHeight = safeZone.bottom - safeZone.top;

  // Too big for the zone: repositioning cannot help, and rescaling is a design call.
  if (boxWidth > zoneWidth + 0.5 || boxHeight > zoneHeight + 0.5) return null;

  let deltaX = 0;
  if (box.left < safeZone.left) deltaX = safeZone.left - box.left;
  else if (box.right > safeZone.right) deltaX = safeZone.right - box.right;

  let deltaY = 0;
  if (box.top < safeZone.top) deltaY = safeZone.top - box.top;
  else if (box.bottom > safeZone.bottom) deltaY = safeZone.bottom - box.bottom;

  if (deltaX === 0 && deltaY === 0) return null;

  // Normalised positions are rounded to six decimals, which is worth ~0.001px on
  // a 1080-wide frame. Rounding to nearest can land the element a fraction of a
  // pixel back outside the line it was just moved inside, so the rounding goes in
  // the direction of the correction — never short of it.
  const roundToward = (value: number, direction: number) => {
    if (direction === 0) return Math.round(value * 1_000_000) / 1_000_000;
    return direction > 0
      ? Math.ceil(value * 1_000_000) / 1_000_000
      : Math.floor(value * 1_000_000) / 1_000_000;
  };

  return {
    position: [
      roundToward(input.position[0] + deltaX / input.frameWidth, deltaX),
      roundToward(input.position[1] + deltaY / input.frameHeight, deltaY)
    ],
    deltaPx: { x: Math.round(deltaX * 10) / 10, y: Math.round(deltaY * 10) / 10 }
  };
}
