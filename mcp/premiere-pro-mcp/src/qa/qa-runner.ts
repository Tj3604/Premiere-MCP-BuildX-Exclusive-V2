/**
 * QA orchestration.
 *
 *   technical QA -> visual QA -> identify safe fixes -> apply -> re-run those
 *   checks -> report
 *
 * Two invariants hold throughout:
 *
 *  - A check that cannot read state reports ERROR. Nothing here converts an
 *    unreadable state into a pass, and a required ERROR makes the whole run
 *    FAILED rather than merely imperfect.
 *  - QA never leaves the project worse than it found it. A failing check does not
 *    trigger a mutation; only an explicitly safe, registered fix does, each one
 *    capped by a retry limit and confirmed by reading the state back.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger } from '../utils/logger.js';
import { resolveWorkflowConfig } from './config.js';
import { FfmpegMediaProbe } from './media.js';
import { computeFinalStatus, computeScore } from './scoring.js';
import { audioPresenceCheck, exportAudioLevelsCheck } from './checks/audio.js';
import { logoPresenceCheck, logoSafeZoneCheck } from './checks/branding.js';
import { captionsCheck } from './checks/captions.js';
import { endCardCheck } from './checks/end-card.js';
import { exportBlackFramesCheck, exportFileCheck } from './checks/export.js';
import { graphicsPresenceCheck } from './checks/graphics.js';
import { frameRateCheck, sequenceResolutionCheck } from './checks/sequence-settings.js';
import { timelineDurationCheck, timelineGapsCheck, timelineOverlapsCheck } from './checks/timeline.js';
import { visualFramesCheck } from './checks/visual-qa.js';
import { fixLogoSafeZone } from './fixes/fix-logo.js';
import { fixOneFrameGap } from './fixes/fix-gap.js';
import type {
  MediaProbe,
  PremiereReader,
  QaCheck,
  QaCheckResult,
  QaContext,
  QaFix,
  QaFixAttempt,
  QaIssue,
  QaReport,
  QaRunOptions
} from './types.js';

/** Every registered check, in report order. */
export const QA_CHECKS: QaCheck[] = [
  sequenceResolutionCheck,
  frameRateCheck,
  timelineGapsCheck,
  timelineOverlapsCheck,
  timelineDurationCheck,
  audioPresenceCheck,
  logoPresenceCheck,
  logoSafeZoneCheck,
  graphicsPresenceCheck,
  captionsCheck,
  endCardCheck,
  exportFileCheck,
  exportBlackFramesCheck,
  exportAudioLevelsCheck,
  visualFramesCheck
];

export const QA_FIXES: QaFix[] = [fixLogoSafeZone, fixOneFrameGap];

/** Hard ceiling on attempts per issue. A fix never loops. */
export const DEFAULT_MAX_FIX_ATTEMPTS = 1;
/** Hard ceiling on fixes in one run, so a pathological timeline cannot thrash. */
export const MAX_FIXES_PER_RUN = 20;

export interface QaRunnerDeps {
  premiere: PremiereReader;
  media?: MediaProbe;
  checks?: QaCheck[];
  fixes?: QaFix[];
  now?: () => number;
  /** Called once with the finished report, for telemetry. Never allowed to throw. */
  onComplete?: (report: QaReport) => void;
}

export class QaRunner {
  private readonly logger = new Logger('QA.Runner');
  private readonly premiere: PremiereReader;
  private readonly media: MediaProbe;
  private readonly checks: QaCheck[];
  private readonly fixes: QaFix[];
  private readonly now: () => number;
  private readonly onComplete: ((report: QaReport) => void) | undefined;

  constructor(deps: QaRunnerDeps) {
    this.premiere = deps.premiere;
    this.media = deps.media ?? new FfmpegMediaProbe();
    this.checks = deps.checks ?? QA_CHECKS;
    this.fixes = deps.fixes ?? QA_FIXES;
    this.now = deps.now ?? (() => Date.now());
    this.onComplete = deps.onComplete;
  }

  private findCheck(checkId: string): QaCheck | undefined {
    return this.checks.find((check) => check.id === checkId);
  }

  private findFix(fixId: string | undefined, issueCode: string): QaFix | undefined {
    if (fixId) {
      const byId = this.fixes.find((fix) => fix.id === fixId);
      if (byId) return byId;
    }
    return this.fixes.find((fix) => fix.handles.includes(issueCode));
  }

  /** Runs one check, timing it and converting a thrown error into ERROR. */
  private async runCheck(check: QaCheck, context: QaContext, rerun = false): Promise<QaCheckResult> {
    const started = this.now();
    try {
      const outcome = await check.run(context);
      return {
        checkId: check.id,
        title: check.title,
        layer: check.layer,
        support: check.support,
        durationMs: this.now() - started,
        rerun,
        ...outcome
      };
    } catch (error) {
      // A check that throws is an ERROR, never a pass and never a silent skip.
      return {
        checkId: check.id,
        title: check.title,
        layer: check.layer,
        support: check.support,
        durationMs: this.now() - started,
        status: 'ERROR',
        issues: [],
        rerun,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /** Re-reads sequence and timeline state so a re-run sees the fixed project. */
  private async refreshState(context: QaContext): Promise<void> {
    if (!context.sequenceId) return;
    try {
      const [sequence, tracks] = await Promise.all([
        this.premiere.getSequenceSettings(context.sequenceId),
        this.premiere.listSequenceTracks(context.sequenceId)
      ]);
      context.sequence = sequence;
      context.tracks = tracks;
    } catch (error) {
      this.logger.warn(`Could not refresh project state: ${error instanceof Error ? error.message : error}`);
    }
  }

  async run(options: QaRunOptions = {}): Promise<QaReport> {
    const startedMs = this.now();
    const startedAt = new Date(startedMs).toISOString();
    const config = resolveWorkflowConfig(options.workflow, options.config ?? {});
    const autoFixEnabled = options.autoFix ?? config.autoFix;
    const visualQaEnabled = options.visualQa ?? config.visualQa;
    const maxAttempts = Math.max(1, options.maxFixAttempts ?? DEFAULT_MAX_FIX_ATTEMPTS);

    const sequenceId = options.sequenceId ?? (await this.safeActiveSequenceId());
    const projectName = options.projectName ?? (await this.safeProjectName()) ?? '(unknown project)';

    const frameOutputDir =
      options.frameOutputDir ?? path.join(os.tmpdir(), `buildx-qa-frames-${startedMs}`);

    const context: QaContext = {
      config,
      sequenceId,
      exportPath: options.exportPath ?? null,
      frameOutputDir,
      premiere: this.premiere,
      media: this.media,
      sequence: null,
      tracks: null
    };

    // Read project state once and share it, so twelve checks are not twelve
    // round trips over the bridge.
    await this.refreshState(context);

    const enabled = new Set([...config.requiredChecks, ...config.optionalChecks]);
    const technicalChecks = this.checks.filter(
      (check) => check.layer === 'technical' && enabled.has(check.id)
    );
    const visualChecks = visualQaEnabled ? this.checks.filter((check) => check.layer === 'visual') : [];

    // 1 - technical QA
    const technical: QaCheckResult[] = [];
    for (const check of technicalChecks) {
      technical.push(await this.runCheck(check, context));
    }

    // 2 - visual QA
    const visual: QaCheckResult[] = [];
    for (const check of visualChecks) {
      visual.push(await this.runCheck(check, context));
    }

    // 3 - first-pass score, recorded BEFORE any repair
    const firstPassScore = computeScore(technical, config);

    // 4 - safe auto-fixes, then re-run only the checks they claim to have fixed
    const fixes: QaFixAttempt[] = [];
    if (autoFixEnabled) {
      await this.applyFixes(technical, context, fixes, maxAttempts);
    }

    const finalScore = computeScore(technical, config);
    const allResults = [...technical, ...visual];
    const finalStatus = computeFinalStatus(allResults, config);

    const requiredIds = new Set(config.requiredChecks);
    const blockingItems: QaIssue[] = [];
    const reviewItems: QaIssue[] = [];
    for (const result of allResults) {
      if (result.status === 'FAIL' && requiredIds.has(result.checkId)) blockingItems.push(...result.issues);
      else if (result.status === 'FAIL' || result.status === 'REVIEW' || result.status === 'AUTO_FIX') {
        reviewItems.push(...result.issues);
      }
    }

    const unavailable = this.checks
      .filter((check) => enabled.has(check.id) || check.layer === 'visual')
      .filter((check) => check.support !== 'VERIFIED' && check.unavailableReason)
      .map((check) => `${check.title}: ${check.unavailableReason}`);

    const report: QaReport = {
      projectName,
      workflow: config.workflow,
      sequenceId,
      startedAt,
      durationMs: this.now() - startedMs,
      technical,
      visual,
      fixes,
      firstPassScore,
      finalScore,
      reviewItems,
      blockingItems,
      finalStatus,
      unavailable,
      autoFixEnabled,
      visualQaEnabled
    };

    if (this.onComplete) {
      try {
        this.onComplete(report);
      } catch (error) {
        // Reporting a QA run must never break the QA run.
        this.logger.warn(`QA telemetry sink threw: ${error instanceof Error ? error.message : error}`);
      }
    }

    return report;
  }

  /**
   * Applies every safe fix, one issue at a time, re-reading state and re-running
   * the originating check after each.
   *
   * Fixes are never planned from the first-pass snapshot. Fixes on one track
   * interact: closing the first gap moves every edge after it, so a second fix
   * planned from the old snapshot targets a position that no longer exists (seen
   * live, 2026-10-06). Each next issue is therefore taken from the fresh re-run.
   *
   * A fix is verified only when its own issue is gone from the re-run and its
   * read-back raised no error. A fix that declines without writing moves on to
   * the next issue; a fix that writes but does not make progress stops work on
   * that check, so a timeline that fights back is left for a human rather than
   * thrashed.
   *
   * `results` is mutated in place: a re-run replaces the original entry, so the
   * final score reflects the repaired state while `firstPassScore`, taken before
   * this runs, still records what the system produced unaided.
   */
  private async applyFixes(
    results: QaCheckResult[],
    context: QaContext,
    fixes: QaFixAttempt[],
    maxAttempts: number
  ): Promise<void> {
    const attemptsByIssue = new Map<string, number>();
    const keyOf = (checkId: string, issue: QaIssue) =>
      `${checkId}::${issue.code}::${issue.location ?? issue.timeSeconds ?? ''}`;
    const countOf = (result: QaCheckResult, code: string) =>
      result.issues.filter((issue) => issue.code === code).length;

    for (let index = 0; index < results.length; index++) {
      if (results[index]!.status !== 'AUTO_FIX') continue;
      const check = this.findCheck(results[index]!.checkId);
      let appliedAny = false;

      while (true) {
        const current = results[index]!;
        const issue = current.issues.find(
          (candidate) =>
            candidate.autoFixable && (attemptsByIssue.get(keyOf(current.checkId, candidate)) ?? 0) < maxAttempts
        );
        if (!issue) break;
        if (fixes.length >= MAX_FIXES_PER_RUN) {
          this.logger.warn(`Auto-fix ceiling of ${MAX_FIXES_PER_RUN} reached; remaining issues left for review.`);
          return;
        }

        const key = keyOf(current.checkId, issue);
        const attempt = (attemptsByIssue.get(key) ?? 0) + 1;
        attemptsByIssue.set(key, attempt);

        const fix = this.findFix(issue.fixId, issue.code);
        if (!fix) {
          fixes.push({
            fixId: issue.fixId ?? '(none)',
            checkId: current.checkId,
            issueCode: issue.code,
            description: 'No registered fix for this issue',
            before: null,
            after: null,
            applied: false,
            verified: false,
            verificationStatus: null,
            error: `No fix handles issue code '${issue.code}'`,
            attempt
          });
          continue;
        }

        let outcome: Awaited<ReturnType<QaFix['apply']>>;
        try {
          outcome = await fix.apply(issue, context);
        } catch (error) {
          outcome = {
            applied: false,
            before: null,
            after: null,
            error: error instanceof Error ? error.message : String(error)
          };
        }

        const record: QaFixAttempt = {
          fixId: fix.id,
          checkId: current.checkId,
          issueCode: issue.code,
          description: fix.describe(issue),
          before: outcome.before,
          after: outcome.after,
          applied: outcome.applied,
          verified: false,
          verificationStatus: null,
          error: outcome.error,
          attempt
        };
        fixes.push(record);
        // Declined or failed without touching anything: try the next issue. The
        // attempt count stops this one being retried.
        if (!outcome.applied) continue;
        appliedAny = true;
        if (!check) break;

        // Re-verify against real state. The fix is only believed if the issue it
        // targeted is gone from the re-run, and the next issue is planned from it.
        await this.refreshState(context);
        const rerun = await this.runCheck(check, context, true);
        results[index] = rerun;

        const resolved =
          !outcome.error && (rerun.status === 'PASS' || countOf(rerun, issue.code) < countOf(current, issue.code));
        record.verified = resolved;
        record.verificationStatus = resolved ? 'PASS' : rerun.status;
        if (!resolved) break;
      }

      const final = results[index]!;
      if (appliedAny && final.status !== 'PASS') {
        this.logger.warn(
          `Auto-fix for ${final.checkId} did not clear the check (now ${final.status}); left for human review.`
        );
      }
    }
  }

  /** Re-runs only the checks that are not currently passing. */
  async rerunFailed(previous: QaReport, options: QaRunOptions = {}): Promise<QaReport> {
    const failedIds = [...previous.technical, ...previous.visual]
      .filter((result) => result.status !== 'PASS' && result.status !== 'SKIPPED')
      .map((result) => result.checkId);

    if (failedIds.length === 0) return previous;

    const config = resolveWorkflowConfig(options.workflow ?? previous.workflow, options.config ?? {});
    return this.run({
      ...options,
      workflow: config.workflow,
      sequenceId: options.sequenceId ?? previous.sequenceId ?? undefined,
      config: {
        ...(options.config ?? {}),
        requiredChecks: config.requiredChecks.filter((id) => failedIds.includes(id)),
        optionalChecks: config.optionalChecks.filter((id) => failedIds.includes(id))
      }
    });
  }

  private async safeActiveSequenceId(): Promise<string | null> {
    try {
      return await this.premiere.getActiveSequenceId();
    } catch {
      return null;
    }
  }

  private async safeProjectName(): Promise<string | null> {
    try {
      return await this.premiere.getProjectName();
    } catch {
      return null;
    }
  }
}

/** Writes a report to disk so the last one can be read back later. */
export function persistReport(report: QaReport, directory: string): string | null {
  try {
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, 'last-qa-report.json');
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    return filePath;
  } catch {
    return null;
  }
}

export function loadLastReport(directory: string): QaReport | null {
  try {
    const filePath = path.join(directory, 'last-qa-report.json');
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as QaReport;
  } catch {
    return null;
  }
}
