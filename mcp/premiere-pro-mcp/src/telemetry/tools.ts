/**
 * MCP tools that expose the telemetry layer.
 *
 * These are the only telemetry surfaces an agent touches directly. Everything
 * else — tool counts, failures, retries, durations — is captured automatically
 * by the dispatch wrapper and needs no tool call.
 *
 * Telemetry tools are deliberately excluded from instrumentation, so recording a
 * correction does not itself register as a Premiere tool call.
 */

import { z } from 'zod';
import { telemetry } from './telemetry.js';
import { buildWeeklyReport, openReadOnly, renderWeeklyReport, weekWindow } from './weekly.js';
import { VIDEO_TYPES } from './videos.js';
import { WORKFLOW_STAGES, type HumanActivityKind, type SessionStatus } from './types.js';

/** Structurally identical to MCPTool; declared here to avoid a circular import. */
export interface TelemetryTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<any>;
}

const stageSchema = z
  .string()
  .describe(`Workflow stage. Known stages: ${WORKFLOW_STAGES.join(', ')}. Custom names are allowed.`);

export const TELEMETRY_TOOLS: TelemetryTool[] = [
  {
    name: 'start_telemetry_session',
    description:
      'Starts a BuildX performance-telemetry session for one production workflow. Call this at the beginning of an edit. Returns the session id. If an unattributed session was auto-opened, it is adopted rather than duplicated.',
    inputSchema: z.object({
      projectName: z.string().describe('Human-readable project name, e.g. "BuildX Podcast Episode 14"'),
      workflowType: z
        .string()
        .describe('Workflow kind, e.g. podcast_short, home_tour, hook_graphic, long_form'),
      baselineHumanMinutes: z
        .number()
        .optional()
        .describe('Traditional manual human minutes for this workflow, for the baseline comparison'),
      sessionId: z.string().optional().describe('Force a specific session id (resume or scripted runs)'),
      notes: z.string().optional().describe('Free-text note stored with the session')
    })
  },
  {
    name: 'end_telemetry_session',
    description:
      'Closes the telemetry session, computes total elapsed / automated / human active time, and returns the finished performance report.',
    inputSchema: z.object({
      status: z
        .enum(['success', 'partial', 'failed', 'abandoned'])
        .optional()
        .describe('Final workflow status. Defaults to success.'),
      sessionId: z.string().optional().describe('Session to close. Defaults to the active session.')
    })
  },
  {
    name: 'get_telemetry_status',
    description:
      'Reports whether telemetry is enabled, where the SQLite store lives, and which session is currently active.',
    inputSchema: z.object({})
  },
  {
    name: 'start_workflow_stage',
    description:
      'Marks the start of a workflow stage (transcription, analysis, cut_planning, timeline_build, graphics, qa, export). Stage durations are aggregated in the report.',
    inputSchema: z.object({
      stage: stageSchema,
      sessionId: z.string().optional()
    })
  },
  {
    name: 'end_workflow_stage',
    description: 'Marks the end of a workflow stage and returns its duration in milliseconds.',
    inputSchema: z.object({
      stage: stageSchema,
      sessionId: z.string().optional()
    })
  },
  {
    name: 'start_human_activity',
    description:
      'Starts measuring human active time — prompting, reviewing, approving, or driving Premiere by hand. Automated processing time is never counted as human labour, so this has to be marked explicitly.',
    inputSchema: z.object({
      reason: z.string().optional().describe('What the human is doing, e.g. "reviewing the rough cut"'),
      kind: z.enum(['intervention', 'correction']).optional(),
      sessionId: z.string().optional()
    })
  },
  {
    name: 'stop_human_activity',
    description: 'Stops the open human-activity span and returns its duration in milliseconds.',
    inputSchema: z.object({
      kind: z.enum(['intervention', 'correction']).optional(),
      sessionId: z.string().optional()
    })
  },
  {
    name: 'record_manual_correction',
    description:
      'Records one manual correction, e.g. "Adjusted lower-third position manually". Supply durationMs to also count the time as human active time.',
    inputSchema: z.object({
      reason: z.string().optional().describe('What had to be corrected by hand'),
      durationMs: z.number().optional().describe('How long the correction took, in ms'),
      sessionId: z.string().optional()
    })
  },
  {
    name: 'record_qa_check',
    description:
      'Records the outcome of a QA or verification check — for example confirming an overlay actually landed via export_frame.',
    inputSchema: z.object({
      passed: z.boolean().describe('Whether the check passed'),
      name: z.string().optional().describe('What was checked, e.g. "logo position V3"'),
      detail: z.string().optional(),
      sessionId: z.string().optional()
    })
  },
  {
    name: 'record_gui_fallback',
    description:
      'Records that an operation had to be driven through the Premiere GUI instead of the bridge. Counted as human time, not automated processing.',
    inputSchema: z.object({
      operation: z.string().describe('What was done by hand, e.g. "caption creation"'),
      reason: z.string().optional().describe('Why the bridge could not do it'),
      durationMs: z.number().optional().describe('How long the GUI work took, in ms'),
      sessionId: z.string().optional()
    })
  },
  {
    name: 'set_session_baseline',
    description:
      'Sets or clears the traditional manual baseline in human minutes for a session, enabling the time-saved comparison.',
    inputSchema: z.object({
      baselineHumanMinutes: z
        .number()
        .nullable()
        .describe('Manual human minutes this workflow used to take. Null clears it.'),
      sessionId: z.string().optional()
    })
  },
  {
    name: 'get_performance_report',
    description:
      'Returns the readable performance report for a session. With no arguments, reports the most recent session.',
    inputSchema: z.object({
      sessionId: z.string().optional().describe('Session to report on. Defaults to the latest session.')
    })
  },
  {
    name: 'get_recent_performance',
    description: 'Lists the most recent telemetry sessions with elapsed and human active time.',
    inputSchema: z.object({
      limit: z.number().optional().describe('How many sessions to list. Defaults to 10.')
    })
  },
  {
    name: 'set_current_video',
    description:
      'Call at the start of editing a video. Every tool call and workflow stage after this counts toward that video (for the weekly time log) until set_current_video is called again. Re-using an id updates its title/type.',
    inputSchema: z.object({
      id: z.string().min(1).describe('Stable video id, e.g. "x1460-short-07" or "ep12".'),
      title: z.string().min(1).describe('Working title.'),
      type: z.enum(VIDEO_TYPES).describe('short | podcast | longform | ad | testimonial | other')
    })
  },
  {
    name: 'mark_video_exported',
    description: 'Marks a video exported (today). Done automatically when export_platform_versions succeeds for the current video.',
    inputSchema: z.object({ id: z.string().min(1) })
  },
  {
    name: 'get_current_video',
    description: 'Which video tool calls are currently counting toward, if any.',
    inputSchema: z.object({})
  },
  {
    name: 'export_time_log',
    description:
      'Writes the weekly per-video time log for the Content Desk: buildx-time-<weekStart>.json in $BUILDX_TIME_LOG_DIR (default ~/Claude Video Editor/time-logs). Defaults to the current Monday-to-Sunday week; any date moves to its Monday. Returns the file path. The current week is also rewritten automatically on export, on session end and every 15 minutes while active.',
    inputSchema: z.object({
      weekStart: z.string().optional().describe('YYYY-MM-DD — any day of the week to log. Default: this week.')
    })
  },
  {
    name: 'get_weekly_report',
    description:
      'Weekly report from local telemetry: shorts made (vertical exports by file, sequences built, platform versions), time per stage and human vs machine time, the tools that failed most with their top error, and QA (runs by status, export-gate overrides with reasons). Says plainly what was not recorded. Reads only.',
    inputSchema: z.object({
      week: z.string().optional().describe('Any date (YYYY-MM-DD) in the Monday-to-Sunday week to report. Default: the last 7 days.')
    })
  },
  {
    name: 'get_monthly_performance',
    description:
      'Returns the monthly performance summary: volume, time split, tool reliability, QA, and — when baselines exist — human time saved.',
    inputSchema: z.object({
      month: z.string().optional().describe('Month as YYYY-MM. Defaults to the current month.')
    })
  },
  {
    name: 'configure_telemetry',
    description:
      'Updates telemetry configuration and persists it to data/telemetry.config.json. hourlyLaborCost drives the labor-equivalent capacity figure; it is never hardcoded.',
    inputSchema: z.object({
      enabled: z.boolean().optional().describe('Master switch. Takes effect on the next server start.'),
      hourlyLaborCost: z.number().nullable().optional().describe('Labour cost per hour used for ROI'),
      currency: z.string().optional().describe('Currency symbol for display, e.g. "$"'),
      autoSession: z
        .boolean()
        .optional()
        .describe('Whether tool calls with no open session start an unattributed one')
    })
  }
];

const TELEMETRY_TOOL_NAMES: ReadonlySet<string> = new Set(TELEMETRY_TOOLS.map((tool) => tool.name));

export function isTelemetryTool(name: string): boolean {
  return TELEMETRY_TOOL_NAMES.has(name);
}

export function getTelemetryTools(): TelemetryTool[] {
  return TELEMETRY_TOOLS;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Executes a telemetry tool. Every branch returns a result object rather than
 * throwing, matching the surrounding dispatcher's contract.
 */
export function executeTelemetryTool(name: string, args: Record<string, any>): any {
  switch (name) {
    case 'start_telemetry_session': {
      const session = telemetry.startSession({
        projectName: args.projectName,
        workflowType: args.workflowType,
        ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
        ...(args.baselineHumanMinutes !== undefined
          ? { baselineHumanMinutes: args.baselineHumanMinutes }
          : {}),
        ...(args.notes !== undefined ? { notes: args.notes } : {})
      });
      if (!session) {
        return { success: false, error: telemetryUnavailableMessage() };
      }
      return {
        success: true,
        sessionId: session.sessionId,
        projectName: session.projectName,
        workflowType: session.workflowType,
        startedAt: session.startedAt,
        baselineHumanMinutes: session.baselineHumanMinutes,
        databasePath: telemetry.getDatabasePath()
      };
    }

    case 'end_telemetry_session': {
      const status = (args.status as SessionStatus | undefined) ?? 'success';
      const session = telemetry.endSession(status, args.sessionId);
      if (!session) return { success: false, error: 'No telemetry session to close.' };
      return {
        success: true,
        session,
        report: telemetry.renderSessionReport(session.sessionId)
      };
    }

    case 'get_telemetry_status': {
      const config = telemetry.getConfig();
      return {
        success: true,
        enabled: telemetry.isEnabled(),
        configuredEnabled: config.enabled,
        databasePath: config.databasePath,
        activeSessionId: telemetry.getActiveSessionId(),
        hourlyLaborCost: config.hourlyLaborCost,
        currency: config.currency,
        autoSession: config.autoSession
      };
    }

    case 'start_workflow_stage': {
      const ok = telemetry.startStage(args.stage, args.sessionId);
      return ok
        ? { success: true, stage: args.stage, started: true }
        : { success: false, error: telemetryUnavailableMessage() };
    }

    case 'end_workflow_stage': {
      const durationMs = telemetry.endStage(args.stage, args.sessionId);
      if (durationMs === null) {
        return { success: false, error: `No open stage '${args.stage}' to end.` };
      }
      return { success: true, stage: args.stage, durationMs };
    }

    case 'start_human_activity': {
      const kind = (args.kind as HumanActivityKind | undefined) ?? 'intervention';
      const ok = telemetry.startHumanActivity(kind, args.reason, args.sessionId);
      return ok
        ? { success: true, kind, reason: args.reason ?? null, started: true }
        : { success: false, error: telemetryUnavailableMessage() };
    }

    case 'stop_human_activity': {
      const kind = (args.kind as HumanActivityKind | undefined) ?? 'intervention';
      const durationMs = telemetry.stopHumanActivity(kind, args.sessionId);
      if (durationMs === null) return { success: false, error: 'No open human-activity span to stop.' };
      return { success: true, kind, durationMs };
    }

    case 'record_manual_correction': {
      const ok = telemetry.recordManualCorrection(args.reason, args.durationMs ?? 0, args.sessionId);
      return ok
        ? { success: true, reason: args.reason ?? null, durationMs: args.durationMs ?? 0 }
        : { success: false, error: telemetryUnavailableMessage() };
    }

    case 'record_qa_check': {
      const ok = telemetry.recordQaCheck(args.passed, args.name, args.detail, args.sessionId);
      return ok
        ? { success: true, passed: args.passed, name: args.name ?? null }
        : { success: false, error: telemetryUnavailableMessage() };
    }

    case 'record_gui_fallback': {
      const ok = telemetry.recordGuiFallback(
        args.operation,
        args.reason,
        args.durationMs ?? 0,
        args.sessionId
      );
      return ok
        ? { success: true, operation: args.operation, durationMs: args.durationMs ?? 0 }
        : { success: false, error: telemetryUnavailableMessage() };
    }

    case 'set_session_baseline': {
      const ok = telemetry.setBaseline(args.baselineHumanMinutes ?? null, args.sessionId);
      return ok
        ? { success: true, baselineHumanMinutes: args.baselineHumanMinutes ?? null }
        : { success: false, error: 'No session to set a baseline on.' };
    }

    case 'get_performance_report': {
      const report = telemetry.getSessionReport(args.sessionId);
      return {
        success: report !== null,
        report: telemetry.renderSessionReport(args.sessionId),
        data: report
      };
    }

    case 'get_recent_performance': {
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      return {
        success: true,
        report: telemetry.renderRecentSessions(limit),
        sessions: telemetry.getRecentSessions(limit)
      };
    }

    case 'set_current_video': {
      try {
        const video = telemetry.setCurrentVideo(args.id, args.title, args.type);
        if (!video) return { success: false, error: 'Telemetry is disabled — nothing is being tracked.' };
        return { success: true, current: video, note: 'Tool calls and stages now count toward this video.' };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'mark_video_exported': {
      try {
        const video = telemetry.markVideoExported(args.id);
        if (!video) return { success: false, error: 'Telemetry is disabled.' };
        return { success: true, video };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'get_current_video': {
      const video = telemetry.getCurrentVideo();
      return { success: true, current: video, note: video ? undefined : 'No current video — work is untracked until set_current_video.' };
    }

    case 'export_time_log': {
      try {
        const out = telemetry.exportTimeLog(args.weekStart);
        if (!out) return { success: false, error: 'Telemetry is disabled — there is nothing to log.' };
        return { success: true, path: out.path, weekStart: out.log.weekStart, weekEnd: out.log.weekEnd, videos: out.log.videos.length, untrackedActiveMin: out.log.untrackedActiveMin };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'get_weekly_report': {
      const file = telemetry.getDatabasePath();
      if (file === ':memory:') return { success: false, error: 'Telemetry is using an in-memory database — there is nothing on disk to report on.' };
      telemetry.flush();
      const db = openReadOnly(file);
      try {
        const report = buildWeeklyReport(db, weekWindow(args.week));
        return { success: true, report: renderWeeklyReport(report), data: report };
      } finally {
        db.close();
      }
    }

    case 'get_monthly_performance': {
      const month = typeof args.month === 'string' ? args.month : currentMonth();
      const summary = telemetry.getMonthlySummary(month);
      return {
        success: summary !== null,
        month,
        report: telemetry.renderMonthlySummary(month),
        data: summary
      };
    }

    case 'configure_telemetry': {
      const config = telemetry.updateConfig({
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.hourlyLaborCost !== undefined ? { hourlyLaborCost: args.hourlyLaborCost } : {}),
        ...(args.currency !== undefined ? { currency: args.currency } : {}),
        ...(args.autoSession !== undefined ? { autoSession: args.autoSession } : {})
      });
      return {
        success: true,
        config,
        note:
          args.enabled !== undefined
            ? 'enabled is persisted but only takes effect on the next server start.'
            : undefined
      };
    }

    default:
      return { success: false, error: `Unknown telemetry tool '${name}'` };
  }
}

function telemetryUnavailableMessage(): string {
  const config = telemetry.getConfig();
  if (!config.enabled) return 'Telemetry is disabled by configuration.';
  return 'Telemetry store is unavailable (node:sqlite requires Node 22.5 or newer). Editing is unaffected.';
}
