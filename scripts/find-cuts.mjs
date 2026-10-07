#!/usr/bin/env node
/**
 * Silence and filler cut list from a WhisperX transcript — review first, cut later.
 *
 * Optional. The first build always uses the full take; this is a tightening pass
 * run only when asked, and nothing is cut unless you approve it.
 *
 * 1. Find:   node scripts/find-cuts.mjs transcripts/<name>.words.json \
 *                 [--min-pause 0.6] [--keep-pause 0.15] [--media <file> | --duration <s>] [--force]
 *            Writes transcripts/<name>.cuts.json + <name>.cuts.md. Every suggestion
 *            starts unapproved. Pauses and um/uh are marked `cut` (recommended);
 *            "like" / "you know" are marked `review`.
 *            Never overwrites an existing .cuts.json (edited approvals) without --force.
 *
 * 2. Review: read <name>.cuts.md. Set `approved` in <name>.cuts.json, or use step 3's flags.
 *
 * 3. Apply:  node scripts/find-cuts.mjs --apply transcripts/<name>.cuts.json \
 *                 [--approve 4,9 | --approve cuts | --approve cuts,9] [--reject 2]
 *            `cuts` takes every row marked cut. With no --approve and nothing set
 *            in the file, the keep list is the whole take.
 *            Writes <name>.keeps.json and prints the plan-cut command. Nothing
 *            touches Premiere until you run plan-cut and place its calls.
 *
 * Needs `npm run build` in mcp/premiere-pro-mcp. --media reads the length with ffprobe.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireTools } from './doctor.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/dist/edit/files.js');

function ids(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'cuts')
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n)) throw new Error(`Not a cut id: ${s}`);
      return n;
    });
}

function parseArgs(argv) {
  const args = { force: false, approve: [], reject: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = argv[++i];
    else if (a === '--min-pause') args.minPause = Number(argv[++i]);
    else if (a === '--keep-pause') args.keepPause = Number(argv[++i]);
    else if (a === '--duration') args.duration = Number(argv[++i]);
    else if (a === '--media') args.media = argv[++i];
    else if (a === '--approve') {
      const v = argv[++i];
      args.approve = ids(v);
      args.approveCuts = String(v).split(',').map((s) => s.trim()).includes('cuts');
    }
    else if (a === '--reject') args.reject = ids(argv[++i]);
    else if (a === '--force') args.force = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.transcript = a;
  }
  return args;
}

function probeDuration(file) {
  requireTools(['ffprobe']);
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8'
  });
  const d = Number(out.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe gave no duration for ${file}`);
  return d;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(DIST)) throw new Error('mcp/premiere-pro-mcp is not built — run `npm run build` there first.');
  const files = await import(pathToFileURL(DIST).href);

  if (args.apply) {
    const result = await files.applyCutList(path.resolve(args.apply), {
      approve: args.approve,
      reject: args.reject,
      approveCuts: args.approveCuts
    });
    const transcript = args.apply.replace(/\.cuts\.json$/i, '.words.json');
    console.log(
      JSON.stringify(
        {
          ok: true,
          keepsPath: result.keepsPath,
          approvedCuts: result.approved,
          note: result.approved.length === 0 ? 'No cuts approved — the keep list is the whole take.' : undefined,
          removedSeconds: result.removedSeconds,
          keptSeconds: result.keptSeconds,
          keepRanges: result.keeps.length,
          next: `node scripts/plan-cut.mjs --keep-file "${result.keepsPath}" --transcript "${transcript}" --pad 0 --fps <seq fps> --sequence-id <SEQ_ID> --project-item-id <ITEM_ID>`
        },
        null,
        2
      )
    );
    return;
  }

  if (!args.transcript) {
    console.error('Usage: node scripts/find-cuts.mjs <name>.words.json [--min-pause s] [--keep-pause s] [--media file|--duration s] [--force]');
    console.error('       node scripts/find-cuts.mjs --apply <name>.cuts.json [--approve 1,2] [--reject 3]');
    process.exit(2);
  }
  const durationSeconds = args.media ? probeDuration(args.media) : args.duration;
  const result = await files.createCutList(
    path.resolve(args.transcript),
    { minPauseSeconds: args.minPause, keepPauseSeconds: args.keepPause, durationSeconds },
    { force: args.force }
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        written: result.written,
        cutsJson: result.cutsJson,
        cutsMd: result.cutsMd,
        summary: result.list.summary,
        note: result.written
          ? 'Review the .cuts.md, then run with --apply.'
          : 'A .cuts.json already exists and was left alone — pass --force to replace it.'
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`find-cuts: ${error.message}`);
  process.exit(1);
});
