#!/usr/bin/env node
/**
 * Call a single Premiere MCP tool from the shell.
 *
 * Useful for testing the bridge without restarting the agent session, and for
 * scripting timeline operations from bash.
 *
 * Usage:
 *   node scripts/mcp-call.mjs <tool_name> ['<json-args>'] [--timeout 60]
 *
 * Examples:
 *   node scripts/mcp-call.mjs get_project_info
 *   node scripts/mcp-call.mjs import_media '{"filePath":"/abs/path/clip.mp4"}'
 *
 * Exits non-zero if the tool errors or the bridge does not answer in time.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/dist/index.js');
const TEMP_DIR = process.env.PREMIERE_TEMP_DIR || '/tmp/premiere-mcp-bridge';

function parseArgs(argv) {
  const out = { timeoutMs: 60000 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--timeout') out.timeoutMs = Number(argv[++i]) * 1000;
    else rest.push(argv[i]);
  }
  out.tool = rest[0];
  out.args = rest[1] ? JSON.parse(rest[1]) : {};
  return out;
}

function callTool({ tool, args, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER_ENTRY], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PREMIERE_TEMP_DIR: TEMP_DIR },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(
        `Timed out after ${timeoutMs / 1000}s waiting for "${tool}".\n` +
        'The CEP panel is almost certainly not running. In Premiere:\n' +
        '  Window > Extensions > MCP Bridge (CEP) > Start Bridge\n' +
        `  (temp directory must be ${TEMP_DIR})\n\n` +
        `Server log:\n${stderr.trim()}`
      ));
    }, timeoutMs);

    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish(reject, err));

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      // The server speaks line-delimited JSON-RPC on stdout.
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }

        if (msg.id === 1) {
          // Initialized — now send the actual tool call.
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 2, method: 'tools/call',
            params: { name: tool, arguments: args },
          }) + '\n');
        }

        if (msg.id === 2) {
          if (msg.error) finish(reject, new Error(`${tool}: ${msg.error.message}`));
          else finish(resolve, msg.result);
        }
      }
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-call', version: '1.0.0' },
      },
    }) + '\n');
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.tool) {
    console.error("Usage: node scripts/mcp-call.mjs <tool_name> ['<json-args>'] [--timeout 60]");
    process.exit(1);
  }

  const result = await callTool(opts);

  // MCP wraps tool output in a content array; unwrap text blocks for readability.
  const text = (result.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  console.log(text || JSON.stringify(result, null, 2));
  if (result.isError) process.exit(2);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
