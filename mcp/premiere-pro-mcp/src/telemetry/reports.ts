/**
 * Report rendering and historical aggregation.
 *
 * Reports are plain text so they read the same in a terminal, in a log and in a
 * tool response. Baseline and ROI blocks appear only when the underlying data
 * exists — an absent baseline is omitted, never guessed.
 */

import {
  WORKFLOW_STAGES,
  type BaselineComparison,
  type MonthlySummary,
  type SessionRecord,
  type SessionReport,
  type StageBreakdown,
  type TelemetryConfig
} from './types.js';

const LABEL_WIDTH = 26;
const VALUE_WIDTH = 10;

/** "36m 46s", "1h 04m 12s", "18s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function formatHours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(2)}h`;
}

/** Words that are acronyms rather than ordinary nouns, so "qa" is not "Qa". */
const ACRONYMS: ReadonlySet<string> = new Set(['qa', 'mcp', 'adu', 'cta', 'gui', 'roi', 'xml', 'ai']);

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

function line(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value.padStart(VALUE_WIDTH)}`;
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function money(amount: number, currency: string): string {
  return `${currency}${amount.toFixed(2)}`;
}

/**
 * Human time saved against a manual baseline. Returns null when the session
 * carries no baseline, so callers can omit the section entirely.
 */
export function computeBaseline(
  session: SessionRecord,
  hourlyLaborCost: number | null,
  currency: string
): BaselineComparison | null {
  if (session.baselineHumanMinutes === null || session.baselineHumanMinutes <= 0) return null;

  const baselineHumanMs = session.baselineHumanMinutes * 60_000;
  const actualHumanMs = session.humanActiveMs;
  const humanMsSaved = baselineHumanMs - actualHumanMs;
  const humanTimeReductionPercent = (humanMsSaved / baselineHumanMs) * 100;
  const hoursSaved = humanMsSaved / 3_600_000;

  return {
    baselineHumanMs,
    actualHumanMs,
    humanMsSaved,
    humanTimeReductionPercent,
    estimatedLaborCapacityRecovered:
      hourlyLaborCost !== null ? hoursSaved * hourlyLaborCost : null,
    currency
  };
}

/** Orders known stages first, in workflow order, then anything custom. */
export function orderStages(breakdown: StageBreakdown[]): StageBreakdown[] {
  const order = new Map<string, number>(WORKFLOW_STAGES.map((stage, index) => [stage, index]));
  return [...breakdown].sort((a, b) => {
    const aIndex = order.get(a.stage) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = order.get(b.stage) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.stage.localeCompare(b.stage);
  });
}

export function renderSessionReport(report: SessionReport): string {
  const { session, baseline } = report;
  const stages = orderStages(report.stages);
  const out: string[] = [];

  out.push('BUILDX MCP PERFORMANCE REPORT', '');
  out.push(`Project: ${session.projectName}`);
  out.push(`Workflow: ${titleCase(session.workflowType)}`);
  out.push(`Session: ${session.sessionId}`);
  out.push(`Started: ${session.startedAt}`);
  if (session.completedAt) out.push(`Completed: ${session.completedAt}`);
  out.push('');

  out.push(line('Total elapsed time', formatDuration(session.totalElapsedMs)));
  out.push(line('Automated processing', formatDuration(session.automatedProcessingMs)));
  out.push(line('Human active time', formatDuration(session.humanActiveMs)));
  out.push('');

  if (stages.length > 0) {
    out.push('STAGES');
    for (const stage of stages) {
      out.push(line(titleCase(stage.stage), formatDuration(stage.durationMs)));
    }
    out.push('');
  }

  out.push('RELIABILITY');
  out.push(line('MCP tool calls', String(session.toolCalls)));
  out.push(line('Successful calls', String(session.successfulCalls)));
  out.push(line('Failed calls', String(session.failedCalls)));
  if (session.timeoutFailures > 0) {
    out.push(line('  of which timeouts', String(session.timeoutFailures)));
  }
  out.push(line('Retries', String(session.retries)));
  out.push(line('GUI fallbacks', String(session.guiFallbacks)));
  out.push(line('Manual corrections', String(session.manualCorrections)));
  out.push('');

  out.push('QA');
  out.push(line('Checks performed', String(session.qaChecks)));
  out.push(line('Failures', String(session.qaFailures)));
  out.push('');

  out.push('FINAL STATUS');
  out.push(titleCase(session.finalStatus));

  if (baseline) {
    out.push('', 'BASELINE COMPARISON');
    out.push(line('Previous human time', formatDuration(baseline.baselineHumanMs)));
    out.push(line('Current human time', formatDuration(baseline.actualHumanMs)));
    out.push(line('Human time saved', formatDuration(baseline.humanMsSaved)));
    out.push(line('Human time reduction', percent(baseline.humanTimeReductionPercent)));
    if (baseline.estimatedLaborCapacityRecovered !== null) {
      out.push('');
      out.push(
        line(
          'Estimated labor-equivalent capacity recovered',
          money(baseline.estimatedLaborCapacityRecovered, baseline.currency)
        ).trimEnd()
      );
      out.push('(Capacity recovered, not direct cash savings.)');
    }
  }

  return out.join('\n');
}

export function buildMonthlySummary(
  month: string,
  sessions: SessionRecord[],
  config: Pick<TelemetryConfig, 'hourlyLaborCost' | 'currency'>
): MonthlySummary {
  const finished = sessions.filter((s) => s.finalStatus !== 'in_progress');
  const successful = sessions.filter((s) => s.finalStatus === 'success').length;
  const failed = sessions.filter((s) => s.finalStatus === 'failed').length;
  const count = sessions.length;
  const divisor = count === 0 ? 1 : count;

  const sum = (pick: (s: SessionRecord) => number): number =>
    sessions.reduce((total, session) => total + pick(session), 0);

  const totalHumanActiveMs = sum((s) => s.humanActiveMs);
  const totalAutomatedProcessingMs = sum((s) => s.automatedProcessingMs);
  const totalElapsedMs = sum((s) => s.totalElapsedMs);
  const toolCalls = sum((s) => s.toolCalls);
  const successfulCalls = sum((s) => s.successfulCalls);
  const failedCalls = sum((s) => s.failedCalls);
  const retries = sum((s) => s.retries);
  const guiFallbacks = sum((s) => s.guiFallbacks);
  const manualCorrections = sum((s) => s.manualCorrections);

  const baselined = sessions.filter(
    (s) => s.baselineHumanMinutes !== null && s.baselineHumanMinutes > 0
  );
  const baselineHumanMs = baselined.reduce(
    (total, s) => total + (s.baselineHumanMinutes ?? 0) * 60_000,
    0
  );
  const actualHumanMsForBaselined = baselined.reduce((total, s) => total + s.humanActiveMs, 0);
  const estimatedHumanMsSaved = baselineHumanMs - actualHumanMsForBaselined;
  const averageHumanTimeReductionPercent =
    baselined.length === 0
      ? 0
      : baselined.reduce((total, s) => {
          const base = (s.baselineHumanMinutes ?? 0) * 60_000;
          return total + ((base - s.humanActiveMs) / base) * 100;
        }, 0) / baselined.length;

  return {
    month,
    sessions: count,
    successfulSessions: successful,
    failedSessions: failed,
    successRatePercent: finished.length === 0 ? 0 : (successful / finished.length) * 100,
    totalHumanActiveMs,
    totalAutomatedProcessingMs,
    totalElapsedMs,
    averageHumanActiveMs: totalHumanActiveMs / divisor,
    averageAutomatedProcessingMs: totalAutomatedProcessingMs / divisor,
    toolCalls,
    successfulCalls,
    failedCalls,
    toolSuccessRatePercent: toolCalls === 0 ? 0 : (successfulCalls / toolCalls) * 100,
    retries,
    averageRetries: retries / divisor,
    guiFallbacks,
    guiFallbackRatePercent: toolCalls === 0 ? 0 : (guiFallbacks / toolCalls) * 100,
    manualCorrections,
    averageManualCorrections: manualCorrections / divisor,
    qaChecks: sum((s) => s.qaChecks),
    qaFailures: sum((s) => s.qaFailures),
    sessionsWithBaseline: baselined.length,
    baselineHumanMs,
    actualHumanMsForBaselined,
    estimatedHumanMsSaved,
    averageHumanTimeReductionPercent,
    estimatedLaborCapacityRecovered:
      config.hourlyLaborCost !== null && baselined.length > 0
        ? (estimatedHumanMsSaved / 3_600_000) * config.hourlyLaborCost
        : null,
    currency: config.currency
  };
}

export function renderMonthlySummary(summary: MonthlySummary): string {
  const out: string[] = [];
  out.push(`BUILDX MCP MONTHLY PERFORMANCE — ${summary.month}`, '');

  out.push('VOLUME');
  out.push(line('Workflows processed', String(summary.sessions)));
  out.push(line('Successful sessions', String(summary.successfulSessions)));
  out.push(line('Failed sessions', String(summary.failedSessions)));
  out.push(line('Success rate', percent(summary.successRatePercent)));
  out.push('');

  out.push('TIME');
  out.push(line('Total human active', formatHours(summary.totalHumanActiveMs)));
  out.push(line('Total automated', formatHours(summary.totalAutomatedProcessingMs)));
  out.push(line('Total elapsed', formatHours(summary.totalElapsedMs)));
  out.push(line('Avg human per production', formatDuration(summary.averageHumanActiveMs)));
  out.push(line('Avg automated per prod.', formatDuration(summary.averageAutomatedProcessingMs)));
  out.push('');

  out.push('RELIABILITY');
  out.push(line('Tool calls', String(summary.toolCalls)));
  out.push(line('Tool success rate', percent(summary.toolSuccessRatePercent)));
  out.push(line('Average retries', summary.averageRetries.toFixed(2)));
  out.push(line('GUI fallback rate', percent(summary.guiFallbackRatePercent)));
  out.push(line('Corrections per prod.', summary.averageManualCorrections.toFixed(2)));
  out.push('');

  out.push('QA');
  out.push(line('Checks performed', String(summary.qaChecks)));
  out.push(line('Failures', String(summary.qaFailures)));

  if (summary.sessionsWithBaseline > 0) {
    out.push('', 'BASELINE COMPARISON');
    out.push(line('Sessions with baseline', String(summary.sessionsWithBaseline)));
    out.push(line('Baseline human time', formatHours(summary.baselineHumanMs)));
    out.push(line('Actual human time', formatHours(summary.actualHumanMsForBaselined)));
    out.push(line('Estimated human saved', formatHours(summary.estimatedHumanMsSaved)));
    out.push(line('Avg time reduction', percent(summary.averageHumanTimeReductionPercent)));
    if (summary.estimatedLaborCapacityRecovered !== null) {
      out.push('');
      out.push(
        `Estimated labor-equivalent capacity recovered: ${money(
          summary.estimatedLaborCapacityRecovered,
          summary.currency
        )}`
      );
      out.push('(Capacity recovered, not direct cash savings.)');
    }
  } else {
    out.push('', 'No baseline recorded for this month — time-saved figures omitted.');
  }

  return out.join('\n');
}

/** Compact one-line-per-session listing for "last N edits". */
export function renderSessionList(sessions: SessionRecord[]): string {
  if (sessions.length === 0) return 'No telemetry sessions recorded yet.';
  const out: string[] = ['BUILDX MCP RECENT SESSIONS', ''];
  for (const session of sessions) {
    out.push(
      `${session.startedAt.slice(0, 16)}  ${session.sessionId}  ${session.finalStatus.padEnd(11)}` +
        `elapsed ${formatDuration(session.totalElapsedMs).padStart(9)}  ` +
        `human ${formatDuration(session.humanActiveMs).padStart(9)}  ` +
        `${session.projectName}`
    );
  }
  return out.join('\n');
}
