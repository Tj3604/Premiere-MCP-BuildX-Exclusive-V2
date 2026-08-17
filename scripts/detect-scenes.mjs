#!/usr/bin/env node
/**
 * Shot detection — video in, JSON shot list out.
 *
 * Replaces the no-op `scene_edit_detection` MCP tool. Two consumers:
 *   - shot logging for B-roll selection
 *   - per-scene subject selection for the vertical reframe (Phase 4)
 *
 * Uses PySceneDetect's AdaptiveDetector, which scores frames with
 * detect-content and then applies a rolling average. Fixed-threshold detection
 * (`detect-content` alone) reads camera movement as a cut and shreds handheld
 * jobsite footage into dozens of false shots.
 *
 * Usage:
 *   node scripts/detect-scenes.mjs <video> [options]
 *     --out <path>         write JSON here (default: stdout only)
 *     --threshold <n>      adaptive_ratio to trigger a cut (default 3.0)
 *     --min-content-val <n>  floor on content_val (default 15.0)
 *     --min-scene-len <n>  minimum shot length in frames (default 15)
 *     --start <t>          e.g. 30s / 00:00:30 / 900 (frames)
 *     --duration <t>       analyse this much from --start
 *     --downscale <n>      speed knob; 0 = auto (default)
 *
 * Output timecodes are ABSOLUTE positions in the source, even when --start is
 * used — verified against PySceneDetect 0.6.7.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { threshold: 3.0, minContentVal: 15.0, minSceneLen: 15, downscale: 0 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--out': args.out = argv[++i]; break;
      case '--threshold': args.threshold = Number(argv[++i]); break;
      case '--min-content-val': args.minContentVal = Number(argv[++i]); break;
      case '--min-scene-len': args.minSceneLen = Number(argv[++i]); break;
      case '--start': args.start = argv[++i]; break;
      case '--duration': args.duration = argv[++i]; break;
      case '--downscale': args.downscale = Number(argv[++i]); break;
      default: rest.push(argv[i]);
    }
  }
  args.input = rest[0];
  return args;
}

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}\n${stderr || stdout}`));
    });
  });
}

/** uv installs tool shims here; not on PATH for non-login shells. */
function resolveBinary(name) {
  const local = path.join(homedir(), '.local', 'bin', name);
  return existsSync(local) ? local : name;
}

/** PySceneDetect writes a blank first line, then the header. */
function parseSceneCsv(csv) {
  const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((l) => l.startsWith('Scene Number'));
  if (headerIndex === -1) throw new Error('Could not find the header row in the scene CSV.');
  return lines.slice(headerIndex + 1).map((line) => {
    const c = line.split(',');
    return {
      index: Number(c[0]),
      start: { frame: Number(c[1]), timecode: c[2], seconds: Number(c[3]) },
      end: { frame: Number(c[4]), timecode: c[5], seconds: Number(c[6]) },
      durationFrames: Number(c[7]),
      durationSeconds: Number(c[9]),
    };
  });
}

async function probeFps(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate', '-of', 'default=nw=1:nk=1', file,
  ]);
  const [num, den] = stdout.trim().split('/').map(Number);
  return den ? num / den : num;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/detect-scenes.mjs <video> [--out shots.json]');
    process.exit(1);
  }
  const videoPath = path.resolve(args.input);
  if (!existsSync(videoPath)) {
    console.error(`Video not found: ${videoPath}`);
    process.exit(1);
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'scenedetect-'));
  try {
    // Order matters: global opts, then `time`, then the detector, then the sink.
    const cmd = ['-i', videoPath];
    if (args.downscale > 0) cmd.push('-d', String(args.downscale));
    if (args.start || args.duration) {
      cmd.push('time');
      if (args.start) cmd.push('--start', args.start);
      if (args.duration) cmd.push('--duration', args.duration);
    }
    cmd.push(
      'detect-adaptive',
      '--threshold', String(args.threshold),
      '--min-content-val', String(args.minContentVal),
      '--min-scene-len', String(args.minSceneLen),
      'list-scenes', '-f', 'scenes.csv', '-o', workDir, '-q',
    );

    const started = Date.now();
    await run(resolveBinary('scenedetect'), cmd);
    const elapsed = (Date.now() - started) / 1000;

    const produced = (await readdir(workDir)).find((f) => f.endsWith('.csv'));
    if (!produced) throw new Error('PySceneDetect produced no CSV.');
    const scenes = parseSceneCsv(await readFile(path.join(workDir, produced), 'utf8'));

    const fps = await probeFps(videoPath);
    const cuts = scenes.slice(1).map((s) => ({
      frame: s.start.frame,
      seconds: s.start.seconds,
      timecode: s.start.timecode,
    }));

    const result = {
      ok: true,
      video: videoPath,
      fps: Number(fps.toFixed(6)),
      detector: 'adaptive',
      params: {
        threshold: args.threshold,
        minContentVal: args.minContentVal,
        minSceneLen: args.minSceneLen,
      },
      range: { start: args.start ?? null, duration: args.duration ?? null },
      sceneCount: scenes.length,
      cutCount: cuts.length,
      elapsedSeconds: Number(elapsed.toFixed(1)),
      cuts,
      scenes,
    };

    if (args.out) {
      const outPath = path.resolve(args.out);
      await writeFile(outPath, JSON.stringify(result, null, 2));
      result.out = path.relative(PROJECT_ROOT, outPath);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
