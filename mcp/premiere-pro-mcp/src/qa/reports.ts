/**
 * QA report rendering.
 */

import type { QaCheckResult, QaFixAttempt, QaReport } from './types.js';

const NAME_WIDTH = 26;
const STATUS_WIDTH = 9;

function line(result: QaCheckResult): string {
  const detail = result.status === 'ERROR' ? (result.error ?? 'check could not run') : (result.detail ?? '');
  return `${result.title.padEnd(NAME_WIDTH)}${result.status.padEnd(STATUS_WIDTH)}${detail}`.trimEnd();
}

function renderFix(fix: QaFixAttempt): string[] {
  const out: string[] = [];
  out.push(`${fix.issueCode} (${fix.checkId})`);
  out.push(`  Correction:   ${fix.description}`);
  if (fix.before) out.push(`  Before:       ${JSON.stringify(fix.before)}`);
  if (fix.after) out.push(`  After:        ${JSON.stringify(fix.after)}`);
  out.push(`  Applied:      ${fix.applied ? 'yes' : 'no'}${fix.error ? ` — ${fix.error}` : ''}`);
  out.push(`  Verification: ${fix.verificationStatus ?? 'not re-run'}${fix.verified ? '' : fix.applied ? ' (did not clear)' : ''}`);
  return out;
}

export function renderQaReport(report: QaReport): string {
  const out: string[] = [];
  out.push('BUILDX AUTOMATED QA REPORT', '');
  out.push(`Project:  ${report.projectName}`);
  out.push(`Workflow: ${report.workflow}`);
  if (report.sequenceId) out.push(`Sequence: ${report.sequenceId}`);
  out.push(`Ran:      ${report.startedAt} (${(report.durationMs / 1000).toFixed(1)}s)`);
  out.push('');

  out.push('TECHNICAL QA');
  for (const result of report.technical) out.push(line(result));
  out.push('');

  if (report.visualQaEnabled) {
    out.push('VISUAL QA');
    if (report.visual.length === 0) out.push('(no visual checks ran)');
    for (const result of report.visual) out.push(line(result));
    out.push('');
  }

  const issues = [...report.blockingItems, ...report.reviewItems];
  if (issues.length > 0) {
    out.push('ISSUES');
    for (const issue of report.blockingItems) out.push(`[BLOCKING] ${issue.message}`);
    for (const issue of report.reviewItems) out.push(`[REVIEW]   ${issue.message}`);
    out.push('');
  }

  if (report.fixes.length > 0) {
    out.push('AUTO-FIXES');
    for (const fix of report.fixes) {
      out.push(...renderFix(fix));
      out.push('');
    }
  } else if (report.autoFixEnabled) {
    out.push('AUTO-FIXES', 'None required.', '');
  } else {
    out.push('AUTO-FIXES', 'Disabled for this run.', '');
  }

  if (report.unavailable.length > 0) {
    out.push('NOT MACHINE-VERIFIABLE');
    for (const entry of report.unavailable) out.push(`- ${entry}`);
    out.push('');
  }

  const successfulFixes = report.fixes.filter((fix) => fix.verified).length;
  out.push('QA METRICS');
  out.push(
    `First-pass:              ${report.firstPassScore.requiredPassed} / ${report.firstPassScore.requiredExecuted}  ${report.firstPassScore.percent}%`
  );
  out.push(
    `Final technical QA:      ${report.finalScore.requiredPassed} / ${report.finalScore.requiredExecuted}  ${report.finalScore.percent}%`
  );
  out.push(`Auto-fixes attempted:    ${report.fixes.length}`);
  out.push(`Auto-fixes successful:   ${successfulFixes}`);
  out.push(`Human review items:      ${report.reviewItems.length}`);
  out.push(`Blocking items:          ${report.blockingItems.length}`);
  out.push('');

  out.push('FINAL STATUS');
  out.push(report.finalStatus);

  return out.join('\n');
}

/** One-line-per-failure summary for show_qa_failures. */
export function renderQaFailures(report: QaReport): string {
  const failing = [...report.technical, ...report.visual].filter(
    (result) => result.status === 'FAIL' || result.status === 'ERROR' || result.status === 'AUTO_FIX'
  );
  if (failing.length === 0 && report.reviewItems.length === 0) {
    return 'No QA failures or review items.';
  }

  const out: string[] = ['BUILDX QA FAILURES', ''];
  for (const result of failing) {
    out.push(`${result.status}  ${result.title} (${result.checkId})`);
    if (result.error) out.push(`      ${result.error}`);
    for (const issue of result.issues) out.push(`      - ${issue.message}`);
  }
  if (report.reviewItems.length > 0) {
    out.push('', 'REVIEW ITEMS');
    for (const issue of report.reviewItems) out.push(`      - ${issue.message}`);
  }
  return out.join('\n');
}
