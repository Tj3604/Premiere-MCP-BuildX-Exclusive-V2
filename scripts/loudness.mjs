#!/usr/bin/env node
/**
 * Measure and normalise export loudness — one file or a whole folder.
 *
 *   node scripts/loudness.mjs <file|folder> [--target -14] [--true-peak -1] [--measure-only] [--force]
 *
 * Default target: -14 LUFS integrated, -1 dBTP (YouTube / Shorts / Reels / TikTok).
 * Use --target -16 for podcasts. A folder means its .mp4/.mov files, not subfolders,
 * and skips files this script already wrote (*-14LUFS.*).
 *
 * Each normalised file is written beside the original as <name>-14LUFS.<ext>; the
 * original is never touched. Files already within 0.5 LU of the target are skipped.
 * Prints a before/after table, then the full results as JSON.
 *
 * Needs `npm run build` in mcp/premiere-pro-mcp.
 */

import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/dist/audio/loudness.js');

function parseArgs(argv) {
  const args = { target: -14, truePeak: -1, measureOnly: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') args.target = Number(argv[++i]);
    else if (a === '--true-peak') args.truePeak = Number(argv[++i]);
    else if (a === '--measure-only') args.measureOnly = true;
    else if (a === '--force') args.force = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.input = a;
  }
  return args;
}

const fmt = (n) => (typeof n === 'number' ? n.toFixed(1).padStart(6) : '     –');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/loudness.mjs <file|folder> [--target -14] [--true-peak -1] [--measure-only] [--force]');
    process.exit(2);
  }
  if (!existsSync(DIST)) throw new Error('mcp/premiere-pro-mcp is not built — run `npm run build` there first.');
  const L = await import(pathToFileURL(DIST).href);
  const target = { ...L.DEFAULT_TARGET, lufs: args.target, truePeak: args.truePeak };

  const input = path.resolve(args.input);
  const files = statSync(input).isDirectory()
    ? (await readdir(input)).filter((f) => /\.(mp4|mov)$/i.test(f) && !/-\d+LUFS(-\d+)?\.\w+$/i.test(f)).sort().map((f) => path.join(input, f))
    : [input];

  const results = [];
  console.log(`target ${target.lufs} LUFS / ${target.truePeak} dBTP`);
  console.log("  before LUFS   TP |  after LUFS   TP | mode     limit | file");
  for (const file of files) {
    try {
      if (args.measureOnly) {
        const m = await L.measureLoudness(file, target);
        results.push({ file, before: m, onTarget: L.onTarget(m, target) });
        console.log(`  ${fmt(m.integratedLufs)} ${fmt(m.truePeakDbtp)} |              ${L.onTarget(m, target) ? 'on target' : `${(target.lufs - m.integratedLufs).toFixed(1)} dB to go`} | ${path.basename(file)}`);
      } else {
        const r = await L.normalizeLoudness(file, target, { force: args.force });
        results.push(r);
        console.log(`  ${fmt(r.before.integratedLufs)} ${fmt(r.before.truePeakDbtp)} | ${fmt(r.after?.integratedLufs)} ${fmt(r.after?.truePeakDbtp)} | ${r.mode.padEnd(8)} ${r.peakReductionDb ? (`-${r.peakReductionDb}dB`).padStart(6) : "      "} | ${path.basename(file)}${r.output ? ` -> ${path.basename(r.output)}` : ''}`);
      }
    } catch (error) {
      results.push({ file, error: error.message });
      console.log(`  error: ${error.message} | ${path.basename(file)}`);
    }
  }
  console.log(JSON.stringify({ ok: true, target, results }, null, 2));
}

main().catch((error) => {
  console.error(`loudness: ${error.message}`);
  process.exit(1);
});
