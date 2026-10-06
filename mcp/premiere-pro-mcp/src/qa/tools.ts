/**
 * MCP tools for automated QA.
 *
 * A small high-level surface rather than one tool per check: the checks are
 * configuration, not API. Seven tools cover running QA, running each layer alone,
 * applying safe fixes, re-running what failed, and reading the last report.
 */

import path from 'node:path';
import { PACKAGE_ROOT } from '../utils/package-root.js';
import { z } from 'zod';
import { telemetry } from '../telemetry/telemetry.js';
import { listWorkflows, resolveWorkflowConfig } from './config.js';
import { ToolPremiereReader, type ToolCaller } from './premiere-reader.js';
import { QaRunner, loadLastReport, persistReport, QA_CHECKS } from './qa-runner.js';
import { renderQaFailures, renderQaReport } from './reports.js';
import type { QaReport, QaRunOptions } from './types.js';

export const QA_REPORT_DIR = path.join(PACKAGE_ROOT, 'data', 'qa');

export interface QaTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<any>;
}

const commonArgs = {
  sequenceId: z.string().optional().describe('Sequence to check. Defaults to the active sequence.'),
  workflow: z
    .string()
    .optional()
    .describe(`QA profile to apply. Known: ${listWorkflows().join(', ')}. Defaults to podcast_short.`),
  projectName: z.string().optional().describe('Name used in the report header'),
  exportPath: z
    .string()
    .optional()
    .describe('Absolute path to the exported file. Enables export, black-frame, audio-level and frame-sampling checks.')
};

export const QA_TOOLS: QaTool[] = [
  {
    name: 'run_buildx_qa',
    description:
      'Runs the full automated QA pass: technical checks, visual frame sampling, safe auto-fixes, re-verification, and a final report. Never reports an edit as correct on the strength of a tool call — every check reads back project state or inspects the exported file. Returns a report and a final status of READY_FOR_REVIEW, REVIEW_REQUIRED, BLOCKED or FAILED.',
    inputSchema: z.object({
      ...commonArgs,
      autoFix: z.boolean().optional().describe('Apply safe auto-fixes. Defaults to the workflow profile.'),
      visualQa: z.boolean().optional().describe('Sample and screen frames. Defaults to the workflow profile.'),
      expectedDurationSeconds: z
        .number()
        .optional()
        .describe('Expected timeline duration, enabling the duration check'),
      requiredGraphics: z
        .array(z.string())
        .optional()
        .describe('Names (substrings) of graphics this edit must contain'),
      maxFixAttempts: z.number().optional().describe('Attempts per issue. Defaults to 1; never loops.')
    })
  },
  {
    name: 'run_technical_qa',
    description:
      'Runs only the objective technical checks — sequence format, timeline integrity, audio, branding, graphics, captions, end card and export. No frames are sampled and nothing is modified.',
    inputSchema: z.object({
      ...commonArgs,
      expectedDurationSeconds: z.number().optional(),
      requiredGraphics: z.array(z.string()).optional()
    })
  },
  {
    name: 'run_visual_qa',
    description:
      'Samples representative frames and screens them. Black frames are reported objectively; everything subjective (framing, overlap, legibility) comes back as REVIEW with frame paths for a human or multimodal agent to inspect. Never changes the edit.',
    inputSchema: z.object({
      ...commonArgs,
      frameOutputDir: z.string().optional().describe('Where to write sampled frames')
    })
  },
  {
    name: 'apply_safe_qa_fixes',
    description:
      'Re-runs QA with auto-fix enabled, applying only fixes that are objective, deterministic, reversible and governed by an existing BuildX rule. Each fix is confirmed by reading state back; a fix that does not clear its check is recorded as failed and left for human review.',
    inputSchema: z.object({
      ...commonArgs,
      maxFixAttempts: z.number().optional()
    })
  },
  {
    name: 'rerun_failed_qa_checks',
    description:
      'Re-runs only the checks that did not pass in the last QA report. Use after fixing something by hand.',
    inputSchema: z.object({
      ...commonArgs
    })
  },
  {
    name: 'get_last_qa_report',
    description: 'Returns the most recent QA report as readable text plus structured data.',
    inputSchema: z.object({})
  },
  {
    name: 'get_qa_failures',
    description:
      'Returns just the failures, errors and human-review items from the most recent QA report.',
    inputSchema: z.object({})
  }
];

const QA_TOOL_NAMES: ReadonlySet<string> = new Set(QA_TOOLS.map((tool) => tool.name));

export function isQaTool(name: string): boolean {
  return QA_TOOL_NAMES.has(name);
}

export function getQaTools(): QaTool[] {
  return QA_TOOLS;
}

/** Turns a finished report into the telemetry record for a QA pass. */
export function summariseForTelemetry(report: QaReport) {
  const all = [...report.technical, ...report.visual];
  const count = (status: string) => all.filter((result) => result.status === status).length;
  return {
    projectName: report.projectName,
    workflow: report.workflow,
    sequenceId: report.sequenceId,
    durationMs: report.durationMs,
    checksExecuted: all.filter((result) => result.status !== 'SKIPPED').length,
    checksPassed: count('PASS'),
    checksFailed: count('FAIL') + count('AUTO_FIX'),
    checksErrored: count('ERROR'),
    checksReview: count('REVIEW'),
    checksSkipped: count('SKIPPED'),
    autoFixesAttempted: report.fixes.length,
    autoFixesSuccessful: report.fixes.filter((fix) => fix.verified).length,
    autoFixesFailed: report.fixes.filter((fix) => !fix.verified).length,
    firstPassPassed: report.firstPassScore.requiredPassed,
    firstPassExecuted: report.firstPassScore.requiredExecuted,
    firstPassPercent: report.firstPassScore.percent,
    finalPassed: report.finalScore.requiredPassed,
    finalExecuted: report.finalScore.requiredExecuted,
    finalPercent: report.finalScore.percent,
    finalStatus: report.finalStatus,
    failedCheckIds: all
      .filter((result) => result.status === 'FAIL' || result.status === 'ERROR' || result.status === 'AUTO_FIX')
      .map((result) => result.checkId)
  };
}

function buildRunner(call: ToolCaller): QaRunner {
  return new QaRunner({
    premiere: new ToolPremiereReader(call),
    onComplete: (report) => {
      // Telemetry is non-critical: recordQaRun already swallows its own failures.
      telemetry.recordQaRun(summariseForTelemetry(report));
    }
  });
}

function optionsFrom(args: Record<string, any>): QaRunOptions {
  const config: Record<string, unknown> = {};
  if (typeof args.expectedDurationSeconds === 'number') {
    config.expectedDurationSeconds = args.expectedDurationSeconds;
  }
  if (Array.isArray(args.requiredGraphics)) config.requiredGraphics = args.requiredGraphics;

  const options: QaRunOptions = {};
  if (args.sequenceId !== undefined) options.sequenceId = args.sequenceId;
  if (args.workflow !== undefined) options.workflow = args.workflow;
  if (args.projectName !== undefined) options.projectName = args.projectName;
  if (args.exportPath !== undefined) options.exportPath = args.exportPath;
  if (args.frameOutputDir !== undefined) options.frameOutputDir = args.frameOutputDir;
  if (args.maxFixAttempts !== undefined) options.maxFixAttempts = args.maxFixAttempts;
  if (Object.keys(config).length > 0) options.config = config as QaRunOptions['config'];
  return options;
}

function respond(report: QaReport) {
  persistReport(report, QA_REPORT_DIR);
  return {
    // `success` describes whether QA ran, not whether the edit passed. The
    // verdict is finalStatus, and it is deliberately never "approved".
    success: report.finalStatus !== 'FAILED',
    finalStatus: report.finalStatus,
    firstPassScore: report.firstPassScore,
    finalScore: report.finalScore,
    autoFixesAttempted: report.fixes.length,
    autoFixesSuccessful: report.fixes.filter((fix) => fix.verified).length,
    reviewItemCount: report.reviewItems.length,
    blockingItemCount: report.blockingItems.length,
    report: renderQaReport(report),
    data: report
  };
}

export async function executeQaTool(
  name: string,
  args: Record<string, any>,
  call: ToolCaller
): Promise<any> {
  switch (name) {
    case 'run_buildx_qa': {
      const runner = buildRunner(call);
      const options = optionsFrom(args);
      if (args.autoFix !== undefined) options.autoFix = args.autoFix;
      if (args.visualQa !== undefined) options.visualQa = args.visualQa;
      return respond(await runner.run(options));
    }

    case 'run_technical_qa': {
      const runner = buildRunner(call);
      return respond(await runner.run({ ...optionsFrom(args), visualQa: false, autoFix: false }));
    }

    case 'run_visual_qa': {
      const runner = buildRunner(call);
      const config = resolveWorkflowConfig(args.workflow);
      // Visual layer only: no technical checks are required or optional.
      return respond(
        await runner.run({
          ...optionsFrom(args),
          visualQa: true,
          autoFix: false,
          config: { ...config, requiredChecks: [], optionalChecks: [] }
        })
      );
    }

    case 'apply_safe_qa_fixes': {
      const runner = buildRunner(call);
      return respond(await runner.run({ ...optionsFrom(args), autoFix: true, visualQa: false }));
    }

    case 'rerun_failed_qa_checks': {
      const previous = loadLastReport(QA_REPORT_DIR);
      if (!previous) {
        return { success: false, error: 'No previous QA report to re-run. Run run_buildx_qa first.' };
      }
      const runner = buildRunner(call);
      return respond(await runner.rerunFailed(previous, optionsFrom(args)));
    }

    case 'get_last_qa_report': {
      const previous = loadLastReport(QA_REPORT_DIR);
      if (!previous) return { success: false, error: 'No QA report has been produced yet.' };
      return {
        success: true,
        finalStatus: previous.finalStatus,
        report: renderQaReport(previous),
        data: previous
      };
    }

    case 'get_qa_failures': {
      const previous = loadLastReport(QA_REPORT_DIR);
      if (!previous) return { success: false, error: 'No QA report has been produced yet.' };
      return {
        success: true,
        finalStatus: previous.finalStatus,
        report: renderQaFailures(previous),
        blockingItems: previous.blockingItems,
        reviewItems: previous.reviewItems
      };
    }

    default:
      return { success: false, error: `Unknown QA tool '${name}'` };
  }
}

/** Support level of every registered check, for documentation and diagnostics. */
export function qaCheckSupportMatrix(): Array<{ id: string; title: string; support: string; note?: string }> {
  return QA_CHECKS.map((check) => ({
    id: check.id,
    title: check.title,
    support: check.support,
    ...(check.unavailableReason ? { note: check.unavailableReason } : {})
  }));
}
