/**
 * Automated QA and safe auto-fix for the BuildX Premiere MCP.
 */

export * from './types.js';
export * from './geometry.js';
export * from './frames.js';
export {
  QA_WORKFLOW_PROFILES,
  DEFAULT_WORKFLOW,
  resolveWorkflowConfig,
  listWorkflows,
  FPS_23_976,
  FPS_29_97,
  FPS_30,
  LOGO_ASSET_WIDTH,
  LOGO_ASSET_HEIGHT,
  DOCUMENTED_LOGO_POSITION,
  DOCUMENTED_LOGO_SCALE
} from './config.js';
export { FfmpegMediaProbe, parseRational, runCommand } from './media.js';
export { ToolPremiereReader, isRealResponse } from './premiere-reader.js';
export type { ToolCaller } from './premiere-reader.js';
export { computeScore, computeFinalStatus } from './scoring.js';
export { renderQaReport, renderQaFailures } from './reports.js';
export {
  QaRunner,
  QA_CHECKS,
  QA_FIXES,
  persistReport,
  loadLastReport,
  DEFAULT_MAX_FIX_ATTEMPTS,
  MAX_FIXES_PER_RUN
} from './qa-runner.js';
export type { QaRunnerDeps } from './qa-runner.js';
export { computeMinimalReposition } from './fixes/fix-safe-zone.js';
export { fixLogoSafeZone } from './fixes/fix-logo.js';
export { fixOneFrameGap } from './fixes/fix-gap.js';
export { primaryVideoTrack, timelineDurationSeconds } from './checks/timeline.js';
export { findLogoClips } from './checks/branding.js';
export {
  QA_TOOLS,
  getQaTools,
  isQaTool,
  executeQaTool,
  qaCheckSupportMatrix,
  summariseForTelemetry,
  QA_REPORT_DIR
} from './tools.js';
export type { QaTool } from './tools.js';
