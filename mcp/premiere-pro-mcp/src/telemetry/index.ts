/**
 * Performance telemetry for the BuildX Premiere MCP.
 *
 * Local-first, SQLite-backed, and non-critical by design: if any part of this
 * layer fails, the editing workflow carries on without it.
 */

export * from './types.js';
export { TelemetryDatabase, SCHEMA_VERSION } from './database.js';
export { SessionManager, mergeIntervalDuration, toLocalIso, rowToSession } from './session.js';
export type { Clock, CounterField } from './session.js';
export { OperationTracker, looksLikeTimeout } from './operations.js';
export {
  formatDuration,
  formatHours,
  computeBaseline,
  orderStages,
  renderSessionReport,
  buildMonthlySummary,
  renderMonthlySummary,
  renderSessionList
} from './reports.js';
export { Telemetry, telemetry, resolveConfig, categorizeTool, analyseResult, UNATTRIBUTED } from './telemetry.js';
export type { TelemetryOptions } from './telemetry.js';
export {
  TELEMETRY_TOOLS,
  getTelemetryTools,
  isTelemetryTool,
  executeTelemetryTool
} from './tools.js';
export type { TelemetryTool } from './tools.js';
