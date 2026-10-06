/**
 * Telemetry tests.
 *
 * Deterministic by construction: every instance is built with a controllable
 * clock and its own temp database, so no assertion depends on real elapsed time.
 * No jest mocking is used — the suite runs under native ESM.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Telemetry } from '../../telemetry/telemetry.js';
import { TelemetryDatabase } from '../../telemetry/database.js';
import {
  computeBaseline,
  formatDuration,
  buildMonthlySummary,
  renderSessionReport
} from '../../telemetry/reports.js';
import { mergeIntervalDuration, toLocalIso } from '../../telemetry/session.js';
import { analyseResult, categorizeTool } from '../../telemetry/telemetry.js';
import { executeTelemetryTool, isTelemetryTool, TELEMETRY_TOOLS } from '../../telemetry/tools.js';
import type { SessionRecord } from '../../telemetry/types.js';

/** A clock the test drives by hand. */
function makeClock(startMs = 1_700_000_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
      return current;
    },
    set: (ms: number) => {
      current = ms;
    }
  };
}

const tempDirs: string[] = [];
const instances: Telemetry[] = [];

function makeTelemetry(overrides: Record<string, unknown> = {}, clockStart?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildx-telemetry-'));
  tempDirs.push(dir);
  const clock = makeClock(clockStart);
  const telemetry = new Telemetry({
    env: {},
    now: clock.now,
    config: {
      enabled: true,
      databasePath: path.join(dir, 'telemetry.sqlite'),
      hourlyLaborCost: null,
      currency: '$',
      autoSession: true,
      flushThreshold: 1,
      flushIntervalMs: 10,
      ...overrides
    } as any
  });
  instances.push(telemetry);
  return { telemetry, clock, dir };
}

afterAll(() => {
  for (const instance of instances) instance.shutdown();
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
});

describe('database initialization', () => {
  it('creates the sqlite file and its parent directory on demand', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildx-telemetry-init-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'nested', 'deeper', 'telemetry.sqlite');
    const db = new TelemetryDatabase(dbPath, 1, 10);

    expect(db.open()).toBe(true);
    expect(db.isAvailable()).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);
    db.close();
  });

  it('creates every expected table', () => {
    const db = new TelemetryDatabase(':memory:', 1, 10);
    expect(db.open()).toBe(true);
    const tables = db
      .query<{ name: unknown }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => String(row.name));
    for (const table of ['sessions', 'operations', 'stages', 'human_activity', 'qa_checks', 'telemetry_errors']) {
      expect(tables).toContain(table);
    }
    db.close();
  });
});

describe('session lifecycle', () => {
  it('starts a session with a generated id and persists it', () => {
    const { telemetry } = makeTelemetry();
    const session = telemetry.startSession({
      projectName: 'BuildX Podcast Episode 14',
      workflowType: 'podcast_short'
    });

    expect(session).not.toBeNull();
    expect(session?.sessionId).toMatch(/^buildx_\d{4}-\d{2}-\d{2}_\d{3}$/);
    expect(session?.projectName).toBe('BuildX Podcast Episode 14');
    expect(session?.finalStatus).toBe('in_progress');
    expect(telemetry.getActiveSessionId()).toBe(session?.sessionId);
  });

  it('increments the daily counter for a second session on the same day', () => {
    const { telemetry } = makeTelemetry();
    const first = telemetry.startSession({ projectName: 'A', workflowType: 'short' });
    const second = telemetry.startSession({ projectName: 'B', workflowType: 'short' });
    expect(first?.sessionId.endsWith('_001')).toBe(true);
    expect(second?.sessionId.endsWith('_002')).toBe(true);
  });

  it('ends a session, recording status and total elapsed time', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'Ep 14', workflowType: 'podcast_short' });
    clock.advance(42 * 60_000);
    const ended = telemetry.endSession('success');

    expect(ended?.finalStatus).toBe('success');
    expect(ended?.totalElapsedMs).toBe(42 * 60_000);
    expect(ended?.completedAt).not.toBeNull();
    expect(telemetry.getActiveSessionId()).toBeNull();
  });

  it('adopts an auto-opened unattributed session rather than duplicating it', async () => {
    const { telemetry } = makeTelemetry();
    await telemetry.instrumentToolCall('get_project_info', async () => ({ success: true }));
    const autoId = telemetry.getActiveSessionId();
    expect(autoId).not.toBeNull();

    const named = telemetry.startSession({ projectName: 'Named', workflowType: 'home_tour' });
    expect(named?.sessionId).toBe(autoId);
    expect(named?.projectName).toBe('Named');
    expect(telemetry.getRecentSessions(10)).toHaveLength(1);
  });
});

describe('operation timing', () => {
  it('computes duration from the clock without the caller supplying timestamps', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    const operation = telemetry.startOperation({ name: 'add_to_timeline', category: 'premiere' });
    clock.advance(2_500);
    operation.success();
    telemetry.flush();

    const report = telemetry.getSessionReport();
    const premiere = report?.categoryBreakdown.find((entry) => entry.stage === 'premiere');
    expect(premiere?.durationMs).toBe(2_500);
  });

  it('logs a failed operation with its error message', async () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    const operation = telemetry.startOperation({ name: 'export_sequence', category: 'export' });
    operation.fail(new Error('bridge did not respond'));
    telemetry.flush();

    const report = telemetry.getSessionReport();
    expect(report?.session.toolCalls).toBe(0); // startOperation is not a tool call
    const exportEntry = report?.categoryBreakdown.find((entry) => entry.stage === 'export');
    expect(exportEntry).toBeDefined();
  });

  it('counts a timeout failure separately', async () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    await telemetry.instrumentToolCall('get_project_info', async () => ({
      success: false,
      error: 'Bridge request timed out after 30000ms'
    }));

    const report = telemetry.getSessionReport();
    expect(report?.session.failedCalls).toBe(1);
    expect(report?.session.timeoutFailures).toBe(1);
  });
});

describe('tool-call instrumentation', () => {
  it('counts calls, successes and failures from the dispatch wrapper', async () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    await telemetry.instrumentToolCall('import_media', async () => ({ success: true, id: '1' }));
    await telemetry.instrumentToolCall('add_to_timeline', async () => ({ success: true }));
    await telemetry.instrumentToolCall('delete_project_item', async () => ({
      success: false,
      error: 'not implemented'
    }));

    const report = telemetry.getSessionReport();
    expect(report?.session.toolCalls).toBe(3);
    expect(report?.session.successfulCalls).toBe(2);
    expect(report?.session.failedCalls).toBe(1);
  });

  it('returns the tool result unchanged', async () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    const result = await telemetry.instrumentToolCall('get_project_info', async () => ({
      success: true,
      name: 'X1234'
    }));
    expect(result).toEqual({ success: true, name: 'X1234' });
  });

  it('rethrows a tool error after recording it', async () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    await expect(
      telemetry.instrumentToolCall('add_to_timeline', async () => {
        throw new Error('bridge offline');
      })
    ).rejects.toThrow('bridge offline');

    const report = telemetry.getSessionReport();
    expect(report?.session.failedCalls).toBe(1);
  });
});

describe('retry counting', () => {
  it('treats a repeat call of a tool that just failed as a retry', async () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    await telemetry.instrumentToolCall('add_to_timeline', async () => ({ success: false, error: 'boom' }));
    await telemetry.instrumentToolCall('add_to_timeline', async () => ({ success: false, error: 'boom' }));
    await telemetry.instrumentToolCall('add_to_timeline', async () => ({ success: true }));

    const report = telemetry.getSessionReport();
    expect(report?.session.toolCalls).toBe(3);
    expect(report?.session.retries).toBe(2);
  });

  it('does not count an unrelated tool call as a retry', async () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    await telemetry.instrumentToolCall('add_to_timeline', async () => ({ success: false, error: 'boom' }));
    await telemetry.instrumentToolCall('get_project_info', async () => ({ success: true }));

    expect(telemetry.getSessionReport()?.session.retries).toBe(0);
  });
});

describe('stage timing', () => {
  it('aggregates duration by stage', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    telemetry.startStage('transcription');
    clock.advance(192_000);
    expect(telemetry.endStage('transcription')).toBe(192_000);

    telemetry.startStage('timeline_build');
    clock.advance(271_000);
    telemetry.endStage('timeline_build');

    const stages = telemetry.getSessionReport()?.stages ?? [];
    expect(stages.find((s) => s.stage === 'transcription')?.durationMs).toBe(192_000);
    expect(stages.find((s) => s.stage === 'timeline_build')?.durationMs).toBe(271_000);
  });

  it('sums repeated runs of the same stage', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    telemetry.startStage('graphics');
    clock.advance(1_000);
    telemetry.endStage('graphics');
    telemetry.startStage('graphics');
    clock.advance(2_000);
    telemetry.endStage('graphics');

    const stages = telemetry.getSessionReport()?.stages ?? [];
    expect(stages.find((s) => s.stage === 'graphics')?.durationMs).toBe(3_000);
  });

  it('closes stages left open when the session ends', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.startStage('export');
    clock.advance(5_000);
    telemetry.endSession('success');

    const stages = telemetry.getSessionReport()?.stages ?? [];
    expect(stages.find((s) => s.stage === 'export')?.durationMs).toBe(5_000);
  });
});

describe('human activity tracking', () => {
  it('measures human active time separately from automated processing', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    const automated = telemetry.startOperation({ name: 'transcribe', category: 'transcription' });
    clock.advance(600_000);
    automated.success();

    telemetry.startHumanActivity('intervention', 'reviewing the rough cut');
    clock.advance(120_000);
    expect(telemetry.stopHumanActivity('intervention')).toBe(120_000);

    const ended = telemetry.endSession('success');
    expect(ended?.automatedProcessingMs).toBe(600_000);
    expect(ended?.humanActiveMs).toBe(120_000);
    expect(ended?.totalElapsedMs).toBe(720_000);
  });

  it('never counts automated processing as human time', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    const operation = telemetry.startOperation({ name: 'export_sequence', category: 'export' });
    clock.advance(900_000);
    operation.success();

    const ended = telemetry.endSession('success');
    expect(ended?.humanActiveMs).toBe(0);
    expect(ended?.automatedProcessingMs).toBe(900_000);
  });

  it('counts overlapping spans once rather than summing them', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    const first = telemetry.startOperation({ name: 'a', category: 'premiere' });
    const second = telemetry.startOperation({ name: 'b', category: 'premiere' });
    clock.advance(10_000);
    first.success();
    second.success();

    const ended = telemetry.endSession('success');
    expect(ended?.automatedProcessingMs).toBe(10_000);
  });

  it('closes an open human span when the session ends', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.startHumanActivity('intervention', 'manually fixing a lower third');
    clock.advance(45_000);
    const ended = telemetry.endSession('partial');
    expect(ended?.humanActiveMs).toBe(45_000);
  });
});

describe('manual corrections', () => {
  it('counts corrections and stores the reason', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });

    telemetry.recordManualCorrection('Adjusted lower-third position manually');
    telemetry.recordManualCorrection('Re-cut a clip by hand');

    expect(telemetry.getSessionReport()?.session.manualCorrections).toBe(2);
  });

  it('adds a correction duration to human active time', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.recordManualCorrection('Nudged the logo', 30_000);
    const ended = telemetry.endSession('success');
    expect(ended?.humanActiveMs).toBe(30_000);
  });

  it('a zero-duration correction adds no human time', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.recordManualCorrection('Noted only');
    const ended = telemetry.endSession('success');
    expect(ended?.humanActiveMs).toBe(0);
    expect(ended?.manualCorrections).toBe(1);
  });
});

describe('GUI fallback counting', () => {
  it('counts a fallback and books its duration as human time', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.recordGuiFallback('caption creation', 'captionTracks is undefined in ExtendScript', 240_000);

    const ended = telemetry.endSession('success');
    expect(ended?.guiFallbacks).toBe(1);
    expect(ended?.humanActiveMs).toBe(240_000);
    expect(ended?.automatedProcessingMs).toBe(0);
  });

  it('counts a fallback marked on a live operation', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    const operation = telemetry.startOperation({ name: 'create_sequence', category: 'premiere' });
    operation.markGuiFallback('all four sequence tools are no-ops');
    operation.success();

    expect(telemetry.getSessionReport()?.session.guiFallbacks).toBe(1);
  });
});

describe('QA checks', () => {
  it('records checks and failures', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.recordQaCheck(true, 'logo on V3');
    telemetry.recordQaCheck(true, 'end card present');
    telemetry.recordQaCheck(false, 'caption timing', 'drifts by 3 frames');

    const report = telemetry.getSessionReport();
    expect(report?.session.qaChecks).toBe(3);
    expect(report?.session.qaFailures).toBe(1);
  });
});

describe('baseline calculations', () => {
  const session = (overrides: Partial<SessionRecord> = {}): SessionRecord =>
    ({
      sessionId: 's',
      projectName: 'P',
      workflowType: 'podcast_short',
      startedAt: '2026-08-24T10:00:00-04:00',
      completedAt: '2026-08-24T10:36:46-04:00',
      startedMs: 0,
      completedMs: 2_206_000,
      totalElapsedMs: 2_206_000,
      automatedProcessingMs: 1_682_000,
      humanActiveMs: 524_000,
      toolCalls: 47,
      successfulCalls: 43,
      failedCalls: 4,
      timeoutFailures: 1,
      retries: 3,
      guiFallbacks: 1,
      manualCorrections: 2,
      qaChecks: 12,
      qaFailures: 1,
      baselineHumanMinutes: 83,
      finalStatus: 'success',
      notes: null,
      ...overrides
    }) as SessionRecord;

  it('computes time saved and reduction percentage', () => {
    const baseline = computeBaseline(session(), null, '$');
    expect(baseline).not.toBeNull();
    expect(baseline?.baselineHumanMs).toBe(83 * 60_000);
    expect(baseline?.humanMsSaved).toBe(83 * 60_000 - 524_000);
    expect(baseline?.humanTimeReductionPercent).toBeCloseTo(89.48, 1);
  });

  it('omits the ROI figure when no labour cost is configured', () => {
    expect(computeBaseline(session(), null, '$')?.estimatedLaborCapacityRecovered).toBeNull();
  });

  it('computes labour-equivalent capacity from the configured hourly cost', () => {
    const baseline = computeBaseline(session(), 60, '$');
    const hoursSaved = (83 * 60_000 - 524_000) / 3_600_000;
    expect(baseline?.estimatedLaborCapacityRecovered).toBeCloseTo(hoursSaved * 60, 5);
  });

  it('returns null when the session has no baseline', () => {
    expect(computeBaseline(session({ baselineHumanMinutes: null }), 60, '$')).toBeNull();
  });

  it('persists a baseline set after the session started', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    expect(telemetry.setBaseline(90)).toBe(true);
    expect(telemetry.getSessionReport()?.session.baselineHumanMinutes).toBe(90);
  });
});

describe('report generation', () => {
  it('renders the headline sections', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({
      projectName: 'BuildX Podcast Episode 14',
      workflowType: 'podcast_short',
      baselineHumanMinutes: 83
    });
    telemetry.startStage('transcription');
    clock.advance(192_000);
    telemetry.endStage('transcription');
    telemetry.startHumanActivity('intervention', 'review');
    clock.advance(60_000);
    telemetry.stopHumanActivity('intervention');
    telemetry.endSession('success');

    const text = telemetry.renderSessionReport();
    expect(text).toContain('BUILDX MCP PERFORMANCE REPORT');
    expect(text).toContain('Project: BuildX Podcast Episode 14');
    expect(text).toContain('Workflow: Podcast Short');
    expect(text).toContain('Total elapsed time');
    expect(text).toContain('Automated processing');
    expect(text).toContain('Human active time');
    expect(text).toContain('STAGES');
    expect(text).toContain('RELIABILITY');
    expect(text).toContain('BASELINE COMPARISON');
  });

  it('omits the baseline section when there is no baseline', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.endSession('success');
    expect(telemetry.renderSessionReport()).not.toContain('BASELINE COMPARISON');
  });

  it('formats durations the way the report reads them', () => {
    expect(formatDuration(2_206_000)).toBe('36m 46s');
    expect(formatDuration(18_000)).toBe('18s');
    expect(formatDuration(3_852_000)).toBe('1h 04m 12s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('builds a monthly summary across sessions', () => {
    const { telemetry, clock } = makeTelemetry();
    for (let i = 0; i < 3; i++) {
      telemetry.startSession({ projectName: `P${i}`, workflowType: 'podcast_short', baselineHumanMinutes: 90 });
      const operation = telemetry.startOperation({ name: 'export_sequence', category: 'export' });
      clock.advance(300_000);
      operation.success();
      telemetry.startHumanActivity('intervention');
      clock.advance(60_000);
      telemetry.stopHumanActivity('intervention');
      telemetry.endSession(i === 2 ? 'failed' : 'success');
    }

    const month = toLocalIso(clock.now()).slice(0, 7);
    const summary = telemetry.getMonthlySummary(month);
    expect(summary?.sessions).toBe(3);
    expect(summary?.successfulSessions).toBe(2);
    expect(summary?.failedSessions).toBe(1);
    expect(summary?.successRatePercent).toBeCloseTo(66.67, 1);
    expect(summary?.sessionsWithBaseline).toBe(3);
    expect(summary?.totalHumanActiveMs).toBe(180_000);
    expect(summary?.totalAutomatedProcessingMs).toBe(900_000);

    const text = telemetry.renderMonthlySummary(month);
    expect(text).toContain('BUILDX MCP MONTHLY PERFORMANCE');
    expect(text).toContain('BASELINE COMPARISON');
  });

  it('reports an empty month without inventing numbers', () => {
    const { telemetry } = makeTelemetry();
    const summary = buildMonthlySummary('2026-01', [], { hourlyLaborCost: 60, currency: '$' });
    expect(summary.sessions).toBe(0);
    expect(summary.successRatePercent).toBe(0);
    expect(summary.estimatedLaborCapacityRecovered).toBeNull();
    expect(telemetry.renderMonthlySummary('2026-01')).toContain('No baseline recorded');
  });

  it('labels ROI as capacity recovered, never cash saved', () => {
    const { telemetry, clock } = makeTelemetry({ hourlyLaborCost: 75 });
    telemetry.startSession({ projectName: 'P', workflowType: 'w', baselineHumanMinutes: 90 });
    clock.advance(60_000);
    telemetry.endSession('success');
    const text = renderSessionReport(telemetry.getSessionReport()!);
    expect(text).toContain('Estimated labor-equivalent capacity recovered');
    expect(text).toContain('not direct cash savings');
    expect(text).not.toContain('cash saved');
  });
});

describe('recent sessions', () => {
  it('lists sessions newest first', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'First', workflowType: 'w' });
    telemetry.endSession('success');
    clock.advance(60_000);
    telemetry.startSession({ projectName: 'Second', workflowType: 'w' });
    telemetry.endSession('success');

    const recent = telemetry.getRecentSessions(5);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.projectName).toBe('Second');
    expect(telemetry.renderRecentSessions(5)).toContain('BUILDX MCP RECENT SESSIONS');
  });
});

describe('telemetry failure does not interrupt normal execution', () => {
  const unopenable = { databasePath: '/dev/null/impossible/telemetry.sqlite' };

  it('reports itself unavailable instead of throwing', () => {
    const { telemetry } = makeTelemetry(unopenable);
    expect(telemetry.isEnabled()).toBe(false);
    expect(() => telemetry.startSession({ projectName: 'P', workflowType: 'w' })).not.toThrow();
    expect(telemetry.startSession({ projectName: 'P', workflowType: 'w' })).toBeNull();
  });

  it('still returns the tool result when the store is broken', async () => {
    const { telemetry } = makeTelemetry(unopenable);
    const result = await telemetry.instrumentToolCall('import_media', async () => ({
      success: true,
      projectItemId: 'abc'
    }));
    expect(result).toEqual({ success: true, projectItemId: 'abc' });
  });

  it('still propagates a real tool error when the store is broken', async () => {
    const { telemetry } = makeTelemetry(unopenable);
    await expect(
      telemetry.instrumentToolCall('add_to_timeline', async () => {
        throw new Error('bridge offline');
      })
    ).rejects.toThrow('bridge offline');
  });

  it('every recording call is a safe no-op when disabled', async () => {
    const { telemetry } = makeTelemetry({ enabled: false });
    expect(telemetry.isEnabled()).toBe(false);
    expect(telemetry.startStage('export')).toBe(false);
    expect(telemetry.endStage('export')).toBeNull();
    expect(telemetry.recordManualCorrection('x')).toBe(false);
    expect(telemetry.recordQaCheck(true)).toBe(false);
    expect(telemetry.recordGuiFallback('captions')).toBe(false);
    expect(telemetry.getRecentSessions()).toEqual([]);
    const result = await telemetry.instrumentToolCall('get_project_info', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('hands out an inert operation handle when disabled', () => {
    const { telemetry } = makeTelemetry({ enabled: false });
    const operation = telemetry.startOperation({ name: 'x', category: 'premiere' });
    expect(operation.operationId).toBe('noop');
    expect(() => {
      operation.markGuiFallback('reason');
      operation.markRetry();
      operation.success();
      operation.fail(new Error('ignored'));
    }).not.toThrow();
  });
});

describe('helpers', () => {
  it('merges overlapping intervals', () => {
    expect(mergeIntervalDuration([])).toBe(0);
    expect(mergeIntervalDuration([{ start: 0, end: 100 }])).toBe(100);
    expect(mergeIntervalDuration([{ start: 0, end: 100 }, { start: 50, end: 150 }])).toBe(150);
    expect(mergeIntervalDuration([{ start: 0, end: 100 }, { start: 200, end: 250 }])).toBe(150);
    expect(mergeIntervalDuration([{ start: 0, end: 100 }, { start: 10, end: 20 }])).toBe(100);
    expect(mergeIntervalDuration([{ start: 5, end: 5 }])).toBe(0);
  });

  it('emits a local ISO timestamp with an offset', () => {
    expect(toLocalIso(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/);
  });

  it('categorises tools by name', () => {
    expect(categorizeTool('export_sequence')).toBe('export');
    expect(categorizeTool('add_to_render_queue')).toBe('export');
    expect(categorizeTool('import_mogrt')).toBe('graphics');
    expect(categorizeTool('list_sequences')).toBe('analysis');
    expect(categorizeTool('add_to_timeline')).toBe('premiere');
    expect(categorizeTool('set_param_value')).toBe('premiere');
  });

  it('reads failure out of a payload that did not throw', () => {
    expect(analyseResult({ success: true }).failed).toBe(false);
    expect(analyseResult({ success: false, error: 'nope' })).toMatchObject({
      failed: true,
      errorMessage: 'nope'
    });
    expect(analyseResult('plain string').failed).toBe(false);
  });

  it("flags the expanded dispatcher's accepted:true stub response", () => {
    expect(analyseResult({ accepted: true }).metadata.stubbedResponse).toBe(true);
    expect(analyseResult({ success: true }).metadata.stubbedResponse).toBeUndefined();
  });
});

describe('telemetry MCP tools', () => {
  it('exposes every documented tool', () => {
    const names = TELEMETRY_TOOLS.map((tool) => tool.name);
    for (const expected of [
      'start_telemetry_session',
      'end_telemetry_session',
      'get_telemetry_status',
      'start_workflow_stage',
      'end_workflow_stage',
      'start_human_activity',
      'stop_human_activity',
      'record_manual_correction',
      'record_qa_check',
      'record_gui_fallback',
      'set_session_baseline',
      'get_performance_report',
      'get_recent_performance',
      'get_monthly_performance',
      'configure_telemetry'
    ]) {
      expect(names).toContain(expected);
      expect(isTelemetryTool(expected)).toBe(true);
    }
    expect(isTelemetryTool('add_to_timeline')).toBe(false);
  });

  it('every tool has a zod schema that parses an empty-ish payload shape', () => {
    for (const tool of TELEMETRY_TOOLS) {
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.description).toBe('string');
    }
  });

  it('rejects an unknown telemetry tool without throwing', () => {
    expect(executeTelemetryTool('not_a_tool', {})).toMatchObject({ success: false });
  });
});

describe('elapsed window covers back-dated work', () => {
  it('never reports a total smaller than the work it contains', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    // Work that ran in a shell before the session row existed.
    telemetry.recordOperation({ name: 'whisperx', category: 'transcription', durationMs: 600_000 });
    clock.advance(1_000);
    const ended = telemetry.endSession('success');

    expect(ended?.automatedProcessingMs).toBe(600_000);
    expect(ended?.totalElapsedMs).toBeGreaterThanOrEqual(ended?.automatedProcessingMs ?? 0);
    expect(ended?.totalElapsedMs).toBe(601_000);
  });

  it('renders QA as an acronym, not "Qa"', () => {
    const { telemetry, clock } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.startStage('qa');
    clock.advance(1_000);
    telemetry.endStage('qa');
    telemetry.endSession('success');
    const text = telemetry.renderSessionReport();
    expect(text).toContain('QA:');
    expect(text).not.toContain('Qa:');
  });
});

describe('recordOperation placement', () => {
  it('sums non-overlapping back-dated work when explicit timing is given', () => {
    const { telemetry, clock } = makeTelemetry();
    const session = telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    const base = clock.now();

    telemetry.recordOperation({
      name: 'whisperx',
      category: 'transcription',
      durationMs: 200_000,
      startedMs: base,
      endedMs: base + 200_000
    });
    telemetry.recordOperation({
      name: 'render_graphic',
      category: 'graphics',
      durationMs: 100_000,
      startedMs: base + 200_000,
      endedMs: base + 300_000
    });

    clock.set(base + 300_000);
    const ended = telemetry.endSession('success', session?.sessionId);
    expect(ended?.automatedProcessingMs).toBe(300_000);
  });

  it('merges duration-only operations recorded in one burst, rather than double counting', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.recordOperation({ name: 'a', category: 'export', durationMs: 500_000 });
    telemetry.recordOperation({ name: 'b', category: 'graphics', durationMs: 100_000 });

    const ended = telemetry.endSession('success');
    // Both spans end "now", so the shorter sits inside the longer.
    expect(ended?.automatedProcessingMs).toBe(500_000);
  });

  it('flags a GUI fallback row so it can be queried directly', () => {
    const { telemetry } = makeTelemetry();
    telemetry.startSession({ projectName: 'P', workflowType: 'w' });
    telemetry.recordGuiFallback('caption creation', 'no scripting surface', 60_000);
    telemetry.flush();

    const report = telemetry.getSessionReport();
    const fallback = report?.categoryBreakdown.find((entry) => entry.stage === 'gui_fallback');
    expect(fallback?.durationMs).toBe(60_000);
    expect(report?.session.guiFallbacks).toBe(1);
  });
});
