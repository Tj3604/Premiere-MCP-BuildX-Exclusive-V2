/**
 * QA scoring and final status.
 *
 * The score is deliberately boring and transparent: required checks passed over
 * required checks executed. A check that was SKIPPED because the workflow does not
 * need it is not counted in either half — padding the denominator with checks that
 * never ran would flatter the score.
 *
 * The first-pass score is the interesting one. It is the share of work that came
 * out right without repair, and it is recorded before any auto-fix runs.
 */

import type { QaCheckResult, QaFinalStatus, QaScore, QaStatus, QaWorkflowConfig } from './types.js';

/** Statuses that count as having actually run. */
const EXECUTED: ReadonlySet<QaStatus> = new Set<QaStatus>(['PASS', 'FAIL', 'AUTO_FIX', 'REVIEW', 'ERROR']);

export function computeScore(results: QaCheckResult[], config: QaWorkflowConfig): QaScore {
  const required = new Set(config.requiredChecks);
  const relevant = results.filter((result) => required.has(result.checkId) && EXECUTED.has(result.status));
  const passed = relevant.filter((result) => result.status === 'PASS').length;
  const executed = relevant.length;
  return {
    requiredExecuted: executed,
    requiredPassed: passed,
    percent: executed === 0 ? 0 : Math.round((passed / executed) * 1000) / 10
  };
}

/**
 * Final verdict.
 *
 * FAILED outranks everything: a required check that could not execute means QA
 * itself did not complete, and an unfinished QA pass is not a passing one.
 * Nothing here can produce a status meaning "approved" — technical QA passing is
 * not editorial sign-off, which is why the best outcome is READY_FOR_REVIEW.
 */
export function computeFinalStatus(
  results: QaCheckResult[],
  config: QaWorkflowConfig
): QaFinalStatus {
  const required = new Set(config.requiredChecks);
  const requiredResults = results.filter((result) => required.has(result.checkId));

  if (requiredResults.some((result) => result.status === 'ERROR')) return 'FAILED';
  if (requiredResults.some((result) => result.status === 'FAIL' || result.status === 'AUTO_FIX')) {
    return 'BLOCKED';
  }

  const hasReview = results.some((result) => result.status === 'REVIEW');
  const optionalFailed = results.some(
    (result) => !required.has(result.checkId) && (result.status === 'FAIL' || result.status === 'ERROR')
  );
  if (hasReview || optionalFailed) return 'REVIEW_REQUIRED';

  return 'READY_FOR_REVIEW';
}
