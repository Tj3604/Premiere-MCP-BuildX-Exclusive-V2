#!/usr/bin/env node
/**
 * Weekly report from local telemetry.
 *
 *   node scripts/weekly-report.mjs [YYYY-MM-DD] [--json]
 *
 * With a date: the Monday-to-Sunday week containing it. Without: the last 7 days.
 * Reads mcp/premiere-pro-mcp/data/telemetry.sqlite (or $BUILDX_TELEMETRY_DB). Reads only.
 * Needs `npm run build` in mcp/premiere-pro-mcp.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp');
const DIST = path.join(PKG, 'dist/telemetry/weekly.js');

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const date = args.find((a) => !a.startsWith('--'));
  if (!existsSync(DIST)) throw new Error('mcp/premiere-pro-mcp is not built — run `npm run build` there first.');
  const db_path = process.env.BUILDX_TELEMETRY_DB || path.join(PKG, 'data/telemetry.sqlite');
  if (!existsSync(db_path)) throw new Error(`No telemetry database at ${db_path}`);
  const W = await import(pathToFileURL(DIST).href);
  const db = W.openReadOnly(db_path);
  try {
    const report = W.buildWeeklyReport(db, W.weekWindow(date));
    console.log(json ? JSON.stringify(report, null, 2) : W.renderWeeklyReport(report));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`weekly-report: ${error.message}`);
  process.exit(1);
});
