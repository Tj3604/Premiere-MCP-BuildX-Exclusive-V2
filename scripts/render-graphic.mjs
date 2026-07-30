#!/usr/bin/env node
/**
 * Render a HyperFrames composition into something Premiere can actually use.
 *
 * Premiere will not reliably import alpha WebM, so for overlays we render WebM
 * (VP9 + alpha) and transcode to ProRes 4444, which Premiere handles natively
 * with a real alpha channel. For full-frame graphics we stay in MP4.
 *
 * Usage:
 *   node scripts/render-graphic.mjs <composition-dir> [--alpha] [--fps 30] [--quality high] [--name my-graphic]
 *
 * Output lands in renders/ and the absolute path is printed as JSON — hand that
 * path straight to the `import_media` MCP tool.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDERS_DIR = path.join(PROJECT_ROOT, 'renders');

function parseArgs(argv) {
  const args = { alpha: false, fps: 30, quality: 'high' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--alpha': args.alpha = true; break;
      // Rational rates (24000/1001) must pass through as strings — Number() makes them NaN.
      case '--fps': { const v = argv[++i]; args.fps = v.includes('/') ? v : Number(v); break; }
      case '--quality': args.quality = argv[++i]; break;
      case '--name': args.name = argv[++i]; break;
      default: rest.push(argv[i]);
    }
  }
  args.dir = rest[0];
  return args;
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'inherit', 'pipe'], ...opts });
    let stderr = '';
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dir) {
    console.error('Usage: node scripts/render-graphic.mjs <composition-dir> [--alpha] [--fps 30] [--quality high] [--name x]');
    process.exit(1);
  }

  const compDir = path.resolve(args.dir);
  if (!(await exists(compDir))) {
    console.error(`Composition directory not found: ${compDir}`);
    process.exit(1);
  }

  const name = args.name || path.basename(compDir);
  await mkdir(RENDERS_DIR, { recursive: true });

  const format = args.alpha ? 'webm' : 'mp4';
  // Render into renders/ directly for MP4; for alpha this is an intermediate.
  const intermediate = path.join(RENDERS_DIR, `${name}.${format}`);

  console.error(`Rendering ${name} (${format}, ${args.fps}fps, ${args.quality})...`);
  await run('npx', [
    '--yes', 'hyperframes@latest', 'render',
    '--output', intermediate,
    '--format', format,
    '--fps', String(args.fps),
    '--quality', args.quality,
  ], { cwd: compDir });

  if (!(await exists(intermediate))) {
    throw new Error(`Render reported success but ${intermediate} does not exist.`);
  }

  let finalPath = intermediate;

  if (args.alpha) {
    finalPath = path.join(RENDERS_DIR, `${name}_ProRes4444.mov`);
    console.error('Transcoding to ProRes 4444 (preserving alpha) for Premiere...');
    // -c:v libvpx-vp9 on the INPUT is required: the native vp9 decoder drops the
    // alpha side-channel, producing an opaque black background in Premiere.
    await run('ffmpeg', [
      '-y',
      '-c:v', 'libvpx-vp9',
      '-i', intermediate,
      '-c:v', 'prores_ks',
      '-profile:v', '4444',
      '-pix_fmt', 'yuva444p10le',
      '-alpha_bits', '16',
      '-vendor', 'ap4h',
      finalPath,
    ]);

    if (!(await exists(finalPath))) {
      throw new Error('ProRes transcode failed to produce an output file.');
    }
    await rm(intermediate, { force: true });
  }

  console.log(JSON.stringify({
    ok: true,
    name,
    alpha: args.alpha,
    fps: args.fps,
    // Absolute path — import_media requires one.
    path: finalPath,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
