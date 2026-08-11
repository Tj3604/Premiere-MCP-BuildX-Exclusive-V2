#!/usr/bin/env node
/**
 * Generates .mcp.json from .mcp.json.example, filling in this clone's absolute path.
 *
 * .mcp.json has to carry an absolute path. Claude Code resolves a relative `args`
 * entry against the process working directory, not the project root — verified: it
 * connects when Claude is launched from the repo root and fails from any
 * subdirectory. `${CLAUDE_PROJECT_DIR}` is not expanded in .mcp.json either (it is
 * a hooks-only variable), so there is no portable placeholder the runtime resolves.
 * Hence: gitignored .mcp.json, tracked .mcp.json.example, this generator.
 *
 * Usage:
 *   node scripts/init-mcp-config.mjs          # write .mcp.json if absent
 *   node scripts/init-mcp-config.mjs --force  # overwrite an existing .mcp.json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_PATH = join(REPO_ROOT, '.mcp.json.example');
const CONFIG_PATH = join(REPO_ROOT, '.mcp.json');
const PLACEHOLDER = '__REPO_ROOT__';

const force = process.argv.includes('--force');

if (!existsSync(EXAMPLE_PATH)) {
  console.error(`Missing template: ${EXAMPLE_PATH}`);
  process.exit(1);
}

const template = readFileSync(EXAMPLE_PATH, 'utf8');

if (!template.includes(PLACEHOLDER)) {
  console.error(`${EXAMPLE_PATH} contains no ${PLACEHOLDER} placeholder.`);
  process.exit(1);
}

const rendered = template.replaceAll(PLACEHOLDER, REPO_ROOT);

try {
  JSON.parse(rendered);
} catch (error) {
  console.error(`Template did not render to valid JSON: ${error.message}`);
  process.exit(1);
}

if (existsSync(CONFIG_PATH)) {
  const current = readFileSync(CONFIG_PATH, 'utf8');
  if (current === rendered) {
    console.log('.mcp.json is already correct for this clone. Nothing to do.');
    process.exit(0);
  }
  if (!force) {
    console.log('.mcp.json already exists and differs from the template.');
    console.log('Leaving it alone. Re-run with --force to overwrite it.');
    process.exit(0);
  }
}

writeFileSync(CONFIG_PATH, rendered);
console.log(`Wrote ${CONFIG_PATH}`);
console.log(`  server path: ${REPO_ROOT}/mcp/premiere-pro-mcp/dist/index.js`);

const distEntry = join(REPO_ROOT, 'mcp/premiere-pro-mcp/dist/index.js');
if (!existsSync(distEntry)) {
  console.log();
  console.log('NOTE: that file does not exist yet. Build the server before starting Claude:');
  console.log('  cd mcp/premiere-pro-mcp && npm install && npm run build');
}
