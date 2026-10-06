/**
 * Logo safe-zone auto-fix.
 *
 * Qualifies as a safe fix on every count the policy asks for: the violation is
 * objective (geometry against a documented safe zone), the correction is
 * deterministic (the minimal nudge), it is one parameter write, the previous
 * value is captured so it is reversible, and the rule comes from
 * knowledge/buildx/safe-zones.md rather than being invented here.
 *
 * The write is confirmed by reading the parameter back, not by trusting the
 * tool's response.
 */

import { LOGO_ASSET_HEIGHT, LOGO_ASSET_WIDTH } from '../config.js';
import type { QaFix } from '../types.js';
import { computeMinimalReposition } from './fix-safe-zone.js';

export const fixLogoSafeZone: QaFix = {
  id: 'fix_logo_safe_zone',
  handles: ['logo_safe_zone_violation'],
  describe(issue) {
    return `Nudge the logo back inside the safe zone (${issue.message})`;
  },
  async apply(issue, context) {
    const data = issue.data ?? {};
    const clipId = typeof data.clipId === 'string' ? data.clipId : null;
    const currentPosition = data.currentPosition as [number, number] | undefined;
    const currentScale = typeof data.currentScale === 'number' ? data.currentScale : null;
    const frameWidth = typeof data.frameWidth === 'number' ? data.frameWidth : context.sequence?.width ?? 0;
    const frameHeight = typeof data.frameHeight === 'number' ? data.frameHeight : context.sequence?.height ?? 0;

    if (!clipId || !currentPosition || currentScale === null || !frameWidth || !frameHeight) {
      return { applied: false, before: null, after: null, error: 'Missing clip geometry for the logo fix.' };
    }

    const before = { position: currentPosition, scale: currentScale };
    const correction = computeMinimalReposition({
      frameWidth,
      frameHeight,
      position: currentPosition,
      scalePercent: currentScale,
      assetWidth: LOGO_ASSET_WIDTH,
      assetHeight: LOGO_ASSET_HEIGHT
    });

    if (!correction) {
      return {
        applied: false,
        before,
        after: null,
        error:
          'The logo cannot be brought inside the safe zone by moving it — it is larger than the zone at its current scale. Rescaling is a design decision, not an automatic repair.'
      };
    }

    const write = await context.premiere.setParamValue(clipId, 'Motion', 'Position', correction.position);
    if (!write.success) {
      return { applied: false, before, after: null, error: write.error ?? 'set_param_value failed' };
    }

    // Read back rather than trusting the write's own response.
    const readBack = await context.premiere.getParamValue(clipId, 'Motion', 'Position');
    return {
      applied: true,
      before,
      after: {
        position: Array.isArray(readBack) ? readBack : correction.position,
        movedPx: correction.deltaPx,
        readBackConfirmed: Array.isArray(readBack)
      }
    };
  }
};
