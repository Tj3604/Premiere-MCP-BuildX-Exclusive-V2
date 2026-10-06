/**
 * Sequence format checks.
 *
 * Both read from get_sequence_settings, which returns real width, height and
 * timebase. get_full_sequence_info returns a stub and carries no frame rate at
 * all, so it is deliberately not used here.
 */

import { formatFps, timebaseMatches, fpsFromTimebase } from '../frames.js';
import type { QaCheck } from '../types.js';

export const sequenceResolutionCheck: QaCheck = {
  id: 'sequence_resolution',
  title: 'Sequence Resolution',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.sequence) {
      return {
        status: 'ERROR',
        issues: [],
        error: 'Could not read sequence settings from Premiere.'
      };
    }

    const { width, height } = context.sequence;
    const expectedWidth = context.config.expectedWidth;
    const expectedHeight = context.config.expectedHeight;
    const actual = `${width}x${height}`;

    if (width === expectedWidth && height === expectedHeight) {
      return { status: 'PASS', detail: actual, issues: [] };
    }

    // Resolution cannot be corrected after the fact — set_sequence_resolution is
    // a no-op, so the sequence has to be rebuilt. Never an auto-fix.
    return {
      status: 'FAIL',
      detail: actual,
      issues: [
        {
          code: 'sequence_resolution_mismatch',
          message: `Sequence is ${actual}, workflow '${context.config.workflow}' requires ${expectedWidth}x${expectedHeight}. Sequence resolution cannot be changed after creation — duplicate a correctly formatted sequence and rebuild.`,
          autoFixable: false,
          data: { actualWidth: width, actualHeight: height, expectedWidth, expectedHeight }
        }
      ]
    };
  }
};

export const frameRateCheck: QaCheck = {
  id: 'frame_rate',
  title: 'Frame Rate',
  layer: 'technical',
  support: 'VERIFIED',
  async run(context) {
    if (!context.sequence) {
      return { status: 'ERROR', issues: [], error: 'Could not read sequence settings from Premiere.' };
    }

    const expected = context.config.expectedFps;
    const actualFps = fpsFromTimebase(context.sequence.timebase);
    const actualLabel = actualFps ? actualFps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : 'unknown';

    if (timebaseMatches(context.sequence.timebase, expected)) {
      return { status: 'PASS', detail: formatFps(expected), issues: [] };
    }

    return {
      status: 'FAIL',
      detail: actualLabel,
      issues: [
        {
          code: 'frame_rate_mismatch',
          message: `Sequence runs at ${actualLabel}fps, workflow '${context.config.workflow}' requires ${formatFps(expected)}fps. set_sequence_frame_rate is a no-op — the sequence has to be rebuilt from a correctly formatted one.`,
          autoFixable: false,
          data: {
            actualTimebase: context.sequence.timebase,
            expectedNumerator: expected.numerator,
            expectedDenominator: expected.denominator
          }
        }
      ]
    };
  }
};
