#!/usr/bin/env node
/**
 * Regenerate TOOL-RELIABILITY.md by auditing the MCP server source.
 *
 * The expanded tool dispatcher ends in a catch-all `default:` that returns
 * `success: true, accepted: true` for any tool it does not explicitly handle.
 * Those tools silently do nothing. This script separates them from the real ones.
 *
 * Run after updating or rebuilding the MCP server.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPANDED = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/src/tools/expanded.ts');
const CORE = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/src/tools/index.ts');
const OUT = path.join(PROJECT_ROOT, 'TOOL-RELIABILITY.md');

const src = readFileSync(EXPANDED, 'utf8');

const arrayMatch = src.match(/export const expandedToolNames = \[([\s\S]*?)\n\]/);
if (!arrayMatch) {
  console.error('Could not locate expandedToolNames — has the server source changed shape?');
  process.exit(1);
}

const names = [...arrayMatch[1].matchAll(/['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]);

const dispatcher = src.slice(src.indexOf('executeExpandedTool'));
const handled = new Set([...dispatcher.matchAll(/case\s+['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]));

const real = names.filter((n) => handled.has(n)).sort();
const fake = names.filter((n) => !handled.has(n)).sort();

// Core tools are the ones registered in index.ts, outside the expanded list.
const coreSrc = readFileSync(CORE, 'utf8');
const coreNames = new Set(
  [...coreSrc.matchAll(/name:\s*['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]).filter((n) => !names.includes(n))
);

const doc = `# Tool Reliability — READ BEFORE TRUSTING A TOOL RESULT

The Premiere MCP advertises **${coreNames.size + names.length} tools**. They are not equally real.

\`src/tools/expanded.ts\` ends its dispatcher with a catch-all:

\`\`\`js
default:
  return ok({ accepted: true, name: toolName, args: args, note: "Expanded tool dispatched..." });
\`\`\`

Any "expanded" tool without an explicit \`case\` returns **\`success: true\` and does nothing**.

## Verified against a live Premiere 2026 session

\`delete_project_item\` and \`delete_multiple_project_items\` both returned
\`success: true, accepted: true\` — and the item was still in the project afterwards.
They are no-ops.

## Counts

| | |
|---|---|
| Core tools (\`index.ts\`, really implemented) | ${coreNames.size} |
| Expanded, really implemented | ${real.length} |
| **Expanded, fake-success no-ops** | **${fake.length}** |

## How to tell at runtime

A response containing \`"accepted": true\` plus the note
\`"Expanded tool dispatched through the native Premiere bridge"\` means **nothing happened**.
Real tools return actual data (IDs, names, counts, durations).

Never report success to the user based on \`accepted: true\`. Verify with a read tool
(\`get_project_info\`, \`list_sequence_tracks\`, \`list_project_items\`) or do it manually.

## The ${fake.length} no-op tools

${fake.map((n) => `- \`${n}\``).join('\n')}

## The ${real.length} expanded tools that are really implemented

${real.map((n) => `- \`${n}\``).join('\n')}

> Regenerate this file after updating the MCP server:
> \`node scripts/audit-tools.mjs\`
`;

writeFileSync(OUT, doc);
console.log(JSON.stringify({
  ok: true,
  core: coreNames.size,
  expandedReal: real.length,
  expandedFake: fake.length,
  wrote: path.relative(PROJECT_ROOT, OUT),
}, null, 2));
