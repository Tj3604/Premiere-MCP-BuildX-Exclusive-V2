#!/usr/bin/env node
/**
 * Read BuildX MCP performance telemetry from the shell.
 *
 * Reads the same local SQLite store the MCP server writes to. Read-only.
 *
 * Usage:
 *   node scripts/telemetry-report.mjs                 # last session report
 *   node scripts/telemetry-report.mjs last
 *   node scripts/telemetry-report.mjs recent [N]      # last N sessions (default 10)
 *   node scripts/telemetry-report.mjs month [YYYY-MM] # monthly summary (default: this month)
 *   node scripts/telemetry-report.mjs session <id>
 *   node scripts/telemetry-report.mjs where           # database path and row counts
 *
 * Requires `npm run build` first — it reads the compiled telemetry layer.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ENTRY = path.join(PACKAGE_ROOT, 'dist', 'telemetry', 'index.js');

if (!existsSync(DIST_ENTRY)) {
  console.error(
    `Compiled telemetry layer not found at ${DIST_ENTRY}\nRun "npm run build" in ${PACKAGE_ROOT} first.`
  );
  process.exit(1);
}

const { telemetry } = await import(DIST_ENTRY);

const [command = 'last', argument] = process.argv.slice(2);

function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

switch (command) {
  case 'last':
    console.log(telemetry.renderSessionReport());
    break;

  case 'session': {
    if (!argument) {
      console.error('Usage: telemetry-report.mjs session <session_id>');
      process.exit(1);
    }
    console.log(telemetry.renderSessionReport(argument));
    break;
  }

  case 'recent': {
    const limit = argument ? Number(argument) : 10;
    console.log(telemetry.renderRecentSessions(Number.isFinite(limit) ? limit : 10));
    break;
  }

  case 'month':
    console.log(telemetry.renderMonthlySummary(argument ?? thisMonth()));
    break;

  case 'where': {
    const sessions = telemetry.getRecentSessions(1000);
    console.log(`Database: ${telemetry.getDatabasePath()}`);
    console.log(`Enabled:  ${telemetry.isEnabled()}`);
    console.log(`Sessions: ${sessions.length}`);
    break;
  }

  default:
    console.error(`Unknown command '${command}'. Try: last, session <id>, recent [N], month [YYYY-MM], where`);
    process.exit(1);
}

telemetry.shutdown();
