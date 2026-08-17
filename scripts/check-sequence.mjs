#!/usr/bin/env node
/**
 * Mandatory startup check — refuse to work in a sequence with the wrong format.
 *
 * Run this after opening any project and before any build step. It hard fails.
 * It does not warn and continue: a 30 fps sequence silently drifts against
 * 29.97 source and the damage is invisible until playback.
 *
 * Usage:
 *   node scripts/check-sequence.mjs                       # active sequence
 *   node scripts/check-sequence.mjs --sequence-id <id>
 *   node scripts/check-sequence.mjs --fps 23.976 --width 3840 --height 2160
 *
 * Exit 0 = conforms. Exit 1 = does not, or could not be determined.
 *
 * NOTE ON THE TOOL USED
 * The integration brief specifies reading the frame rate back with
 * `get_full_sequence_info`. That tool does not report frame rate — verified
 * live, it returns name/id/durationSeconds/width/height/tracks and no timebase
 * of any kind. `get_sequence_settings` is the tool that exposes it, so this
 * uses that instead and cross-checks the dimensions against both.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MCP_CALL = path.join(PROJECT_ROOT, 'scripts', 'mcp-call.mjs');

// Premiere counts time in ticks. This many per second, always.
const TICKS_PER_SECOND = 254016000000n;

// Exact tick counts per frame for the rates that turn up in BuildX work.
// Integer comparison beats float tolerance — 29.97 is 30000/1001 and never
// lands on a clean decimal.
const KNOWN_TIMEBASES = {
  '8475667200': '29.97 (30000/1001)',
  '8467200000': '30',
  '10594584000': '23.976 (24000/1001)',
  '10584000000': '24',
  '10160640000': '25',
  '4237833600': '59.94 (60000/1001)',
  '4233600000': '60',
  '5080320000': '50',
};

const BUILDX_DEFAULTS = { fps: 29.97, width: 1080, height: 1920 };

function parseArgs(argv) {
  const out = { ...BUILDX_DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sequence-id': out.sequenceId = argv[++i]; break;
      case '--fps': out.fps = Number(argv[++i]); break;
      case '--width': out.width = Number(argv[++i]); break;
      case '--height': out.height = Number(argv[++i]); break;
      case '--quiet': out.quiet = true; break;
    }
  }
  return out;
}

function mcp(tool, args = {}, timeoutSec = 40) {
  return new Promise((resolve, reject) => {
    const argv = [MCP_CALL, tool];
    if (Object.keys(args).length) argv.push(JSON.stringify(args));
    argv.push('--timeout', String(timeoutSec));

    const child = spawn('node', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(
          `${tool} did not return JSON. Is the CEP bridge running?\n` +
          `${stderr.trim() || stdout.trim() || '(no output)'}`
        ));
      }
    });
  });
}

/** Ticks per frame -> frames per second, as an exact-ish rational. */
function timebaseToFps(timebase) {
  const tb = BigInt(String(timebase));
  if (tb <= 0n) return null;
  // Scale up so 29.97 keeps its precision through the integer divide.
  return Number((TICKS_PER_SECOND * 1000000n) / tb) / 1000000;
}

function fpsToTimebase(fps) {
  // The broadcast rates are all N/1001. Match on the known table first so we
  // compare integers rather than trusting a float round-trip.
  for (const [tb, label] of Object.entries(KNOWN_TIMEBASES)) {
    if (Math.abs(timebaseToFps(tb) - fps) < 0.005) return { timebase: tb, label };
  }
  return null;
}

export async function checkSequence({ sequenceId, fps, width, height, quiet } = { ...BUILDX_DEFAULTS }) {
  const problems = [];

  let id = sequenceId;
  let projectName = null;
  if (!id) {
    const info = await mcp('get_project_info');
    if (!info?.success) throw new Error('get_project_info failed — is a project open?');
    projectName = info.name;
    if (!info.hasActiveSequence) {
      throw new Error('No active sequence. Open one, or pass --sequence-id.');
    }
    id = info.activeSequence.id;
  }

  const res = await mcp('get_sequence_settings', { sequenceId: id });
  const s = res?.settings;
  if (!res?.success || !s) {
    throw new Error(`get_sequence_settings failed for ${id}. Cannot verify format — refusing to continue.`);
  }

  if (s.timebase === undefined || s.timebase === null) {
    throw new Error('Sequence settings carried no timebase. Cannot verify frame rate — refusing to continue.');
  }

  const actualFps = timebaseToFps(s.timebase);
  const expected = fpsToTimebase(fps);
  const fpsOk = expected
    ? String(s.timebase) === expected.timebase
    : Math.abs(actualFps - fps) < 0.005;

  if (!fpsOk) {
    problems.push(
      `frame rate is ${actualFps.toFixed(3)} (timebase ${s.timebase}` +
      `${KNOWN_TIMEBASES[String(s.timebase)] ? ` = ${KNOWN_TIMEBASES[String(s.timebase)]}` : ''}), expected ${fps}`
    );
  }
  if (Number(s.width) !== width || Number(s.height) !== height) {
    problems.push(`resolution is ${s.width}x${s.height}, expected ${width}x${height}`);
  }

  const result = {
    ok: problems.length === 0,
    projectName,
    sequenceId: id,
    sequenceName: s.name,
    fps: Number(actualFps.toFixed(6)),
    timebase: String(s.timebase),
    width: Number(s.width),
    height: Number(s.height),
    expected: { fps, width, height },
    problems,
  };

  if (!quiet) console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  try {
    result = await checkSequence(args);
  } catch (err) {
    console.error('\nSEQUENCE CHECK FAILED — STOPPING\n');
    console.error(`  ${err.message}\n`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error('\nSEQUENCE CHECK FAILED — STOPPING\n');
    console.error(`  Sequence: ${result.sequenceName} (${result.sequenceId})`);
    for (const p of result.problems) console.error(`  - ${p}`);
    console.error(
      '\n  Do not continue in this sequence. Start from the template:\n' +
      '      node scripts/new-project.mjs "X0000 (surname)" --dest <dir>\n' +
      '  Sequences cannot be reliably created or retimed through the MCP —\n' +
      '  create_sequence, set_sequence_frame_rate and set_sequence_resolution\n' +
      '  are all no-ops that report success.\n'
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
