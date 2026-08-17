#!/usr/bin/env node
/**
 * Reframe horizontal footage to a vertical master.
 *
 * This is an INGEST step, not a timeline operation. It renders a new 1080x1920
 * file into `reframed/`, which is then imported like any other source. All five
 * Motion tools (set_clip_position, set_clip_scale, set_clip_anchor_point,
 * set_uniform_scale, set_scale_to_frame_size) are no-ops, so reframing cannot
 * happen inside Premiere.
 *
 * Wraps `verthor` (KazKozDev/auto-vertical-reframe).
 *
 * Usage:
 *   node scripts/reframe-vertical.mjs <input> [options]
 *     --out <path>        output file (default: reframed/<name>_vertical.mp4)
 *     --out-dir <dir>     output directory (default: reframed/)
 *     --preset <p>        talking_head | sports | pets | cars (default talking_head)
 *     --two-person        enable two-person framing for host + guest shots
 *     --two-person-threshold <n>
 *     --saliency <m>      handcrafted | deepgazemr | auto (default handcrafted)
 *     --device <d>        auto | cpu | cuda | mps
 *     --debug             write a debug preview alongside the output
 *     --start <t>         trim before reframing, e.g. 1200 or 00:20:00
 *     --duration <t>      length of the trimmed segment
 *     --crf <n>           output quality (default verthor's)
 *
 * Writes a sidecar <output>.report.json with the run summary.
 *
 * THE FAILURE MODE THIS GUARDS
 * verthor silently falls back from deepgazemr to handcrafted if the model will
 * not load, and it will happily reframe onto the wrong subject without erroring.
 * Both are visible only in its summary line, so this parses that summary, prints
 * the active backend every run, and exits non-zero when the backend it actually
 * used is not the one that was asked for.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Below this share of frames holding a subject, the reframe is not trustworthy
// even though verthor will still emit a finished file.
const SUBJECT_COVERAGE_FLOOR = 0.9;

function parseArgs(argv) {
  const args = { preset: 'talking_head', saliency: 'handcrafted' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--out': args.out = argv[++i]; break;
      case '--out-dir': args.outDir = argv[++i]; break;
      case '--preset': args.preset = argv[++i]; break;
      case '--two-person': args.twoPerson = true; break;
      case '--two-person-threshold': args.twoPersonThreshold = argv[++i]; break;
      case '--saliency': args.saliency = argv[++i]; break;
      case '--device': args.device = argv[++i]; break;
      case '--debug': args.debug = true; break;
      case '--start': args.start = argv[++i]; break;
      case '--duration': args.duration = argv[++i]; break;
      case '--crf': args.crf = argv[++i]; break;
      default: rest.push(argv[i]);
    }
  }
  args.input = rest[0];
  return args;
}

function run(cmd, cmdArgs, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const feed = (chunk, sink) => {
      const text = String(chunk);
      if (sink === 'out') stdout += text; else stderr += text;
      if (onLine) for (const line of text.split('\n')) if (line.trim()) onLine(line);
    };
    child.stdout.on('data', (d) => feed(d, 'out'));
    child.stderr.on('data', (d) => feed(d, 'err'));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

function resolveBinary(name) {
  const local = path.join(homedir(), '.local', 'bin', name);
  return existsSync(local) ? local : name;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/reframe-vertical.mjs <input> [--two-person] [--debug]');
    process.exit(1);
  }
  const inputPath = path.resolve(args.input);
  if (!existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outDir = path.resolve(args.outDir ?? path.join(PROJECT_ROOT, 'reframed'));
  await mkdir(outDir, { recursive: true });
  const outPath = args.out ? path.resolve(args.out) : path.join(outDir, `${baseName}_vertical.mp4`);

  // Never overwrite: Premiere loses the media link when a file it has imported
  // changes underneath it.
  if (existsSync(outPath)) {
    console.error(`Refusing to overwrite ${outPath}. Pass --out for a new name.`);
    process.exit(1);
  }

  let workDir = null;
  let sourceForReframe = inputPath;
  try {
    if (args.start || args.duration) {
      workDir = await mkdtemp(path.join(tmpdir(), 'reframe-'));
      sourceForReframe = path.join(workDir, `${baseName}_segment.mp4`);
      const ff = ['-v', 'error'];
      if (args.start) ff.push('-ss', String(args.start));
      if (args.duration) ff.push('-t', String(args.duration));
      ff.push('-i', inputPath, '-c:v', 'libx264', '-crf', '16', '-c:a', 'aac', '-y', sourceForReframe);
      console.error(`Trimming segment (${args.start ?? 0} +${args.duration ?? 'end'})...`);
      await run('ffmpeg', ff);
    }

    const cmd = [
      sourceForReframe, outPath,
      '--preset', args.preset,
      '--saliency-model', args.saliency,
      '--output-width', '1080', '--output-height', '1920',
      '--log-level', 'INFO',
    ];
    if (args.twoPerson) cmd.push('--two-person-framing');
    if (args.twoPersonThreshold) cmd.push('--two-person-threshold', args.twoPersonThreshold);
    if (args.device) cmd.push('--saliency-device', args.device);
    if (args.crf) cmd.push('--crf', args.crf);
    if (args.debug) {
      cmd.push('--save-debug-preview', '--debug-path', path.join(outDir, `${baseName}_debug.mp4`));
    }

    console.error(`Reframing ${path.basename(inputPath)} (${args.preset}, saliency=${args.saliency}${args.twoPerson ? ', two-person' : ''})...`);

    let summary = null;
    const progress = [];
    const started = Date.now();
    await run(resolveBinary('verthor'), cmd, (line) => {
      const m = line.match(/Summary:\s*(\{.*\})\s*$/);
      if (m) {
        try { summary = JSON.parse(m[1]); } catch { /* keep raw below */ }
      } else if (/\|\s*Processed \d+\/\d+/.test(line)) {
        progress.push(line.trim());
      }
    });
    const elapsed = (Date.now() - started) / 1000;

    if (!summary) {
      throw new Error('verthor emitted no summary line — cannot verify which saliency backend ran. Treating as failed.');
    }

    const requested = summary.saliency_requested_backend;
    const active = summary.saliency_active_backend;
    const fallbackFrames = summary.saliency_frames_fallback ?? 0;
    const total = summary.frames_processed || 1;
    // frames_with_subject and frames_with_two_person are MUTUALLY EXCLUSIVE —
    // a frame held in two-person framing is not counted as a single subject.
    // Reading frames_with_subject alone reports a perfect two-person reframe as
    // 0% coverage.
    const singleFrames = summary.frames_with_subject ?? 0;
    const twoPersonFrames = summary.frames_with_two_person ?? 0;
    const framedCoverage = (singleFrames + twoPersonFrames) / total;
    const faceCoverage = (summary.frames_with_face ?? 0) / total;

    const warnings = [];
    if (requested !== active) {
      warnings.push(`SALIENCY FELL BACK: asked for "${requested}", actually ran "${active}".`);
    }
    if (fallbackFrames > 0) {
      warnings.push(`${fallbackFrames}/${total} frames used the fallback backend.`);
    }
    if (framedCoverage < SUBJECT_COVERAGE_FLOOR) {
      warnings.push(
        `Framed on only ${(framedCoverage * 100).toFixed(1)}% of frames ` +
        `(floor ${(SUBJECT_COVERAGE_FLOOR * 100).toFixed(0)}%). Review before using.`
      );
    }
    // THE IMPORTANT ONE. frames_with_face counts faces inside the OUTPUT crop,
    // not in the source. High framed coverage with zero faces means verthor
    // tracked the subjects fine and then cropped somewhere they are not — the
    // two-person centre-between-them case, which lands on the set instead of on
    // either person. Every stat looks perfect; only this ratio gives it away.
    if (framedCoverage > 0.5 && faceCoverage === 0) {
      warnings.push(
        'NO FACE IN THE OUTPUT CROP on any frame, despite subjects being tracked. ' +
        'The crop is almost certainly framed on the set rather than on a person. ' +
        'Check the debug preview before using this.'
      );
    }
    // A clip that keeps flipping between one and two subjects is where the
    // reframe wanders; steady in either mode is fine.
    if (singleFrames > 0 && twoPersonFrames > 0) {
      warnings.push(
        `Mixed framing: ${singleFrames} single-subject and ${twoPersonFrames} two-person frames. ` +
        'Check the debug preview for the transitions.'
      );
    }
    if ((summary.subject_switches ?? 0) > 0) {
      warnings.push(`${summary.subject_switches} subject switch(es) — check it did not jump to the wrong person.`);
    }

    const report = {
      ok: warnings.length === 0,
      input: inputPath,
      output: outPath,
      debugPreview: args.debug ? path.join(outDir, `${baseName}_debug.mp4`) : null,
      preset: args.preset,
      twoPerson: Boolean(args.twoPerson),
      segment: { start: args.start ?? null, duration: args.duration ?? null },
      saliency: { requested, active, fallbackFrames, device: summary.saliency_device },
      coverage: {
        framed: Number(framedCoverage.toFixed(4)),
        face: Number(faceCoverage.toFixed(4)),
        singleSubjectFrames: singleFrames,
        twoPersonFrames,
        subjectSwitches: summary.subject_switches ?? 0,
        sceneResets: summary.scene_resets ?? 0,
      },
      framesProcessed: total,
      elapsedSeconds: Number(elapsed.toFixed(1)),
      warnings,
      rawSummary: summary,
    };

    await writeFile(`${outPath}.report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    if (requested !== active) {
      console.error('\nRefusing to report success: the saliency backend silently changed.\n');
      process.exit(1);
    }
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
