#!/usr/bin/env node
/**
 * YouTube Shorts / Reels / TikTok versions of finished 9:16 exports.
 *
 *   node scripts/platform-export.mjs <export.mp4 | folder> [--only youtube-shorts,reels,tiktok]
 *
 * Writes "<name> - YouTube Shorts.mp4", "- Reels.mp4", "- TikTok.mp4" into a
 * "Platform Versions" folder beside each export: H.264 High / AAC, source frame
 * rate, -14 LUFS / -1 dBTP, under 480 MB. Never overwrites. A folder means its
 * .mp4/.mov files (not subfolders). Needs `npm run build` in mcp/premiere-pro-mcp.
 */

import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireTools } from './doctor.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/dist/export/platforms.js');

async function main() {
  const argv = process.argv.slice(2);
  requireTools(['ffmpeg', 'ffprobe']);
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? argv[onlyAt + 1].split(',') : undefined;
  const input = argv.find((a, i) => !a.startsWith('--') && (onlyAt < 0 || i !== onlyAt + 1));
  if (!input) {
    console.error('Usage: node scripts/platform-export.mjs <export.mp4 | folder> [--only youtube-shorts,reels,tiktok]');
    process.exit(2);
  }
  if (!existsSync(DIST)) throw new Error('mcp/premiere-pro-mcp is not built — run `npm run build` there first.');
  const P = await import(pathToFileURL(DIST).href);
  const abs = path.resolve(input);
  const files = statSync(abs).isDirectory()
    ? (await readdir(abs)).filter((f) => /\.(mp4|mov)$/i.test(f)).sort().map((f) => path.join(abs, f))
    : [abs];
  const all = [];
  for (const file of files) {
    try {
      const r = await P.exportPlatformVersions(file, only);
      all.push(r);
      console.log(`\n${path.basename(file)}  (${r.sourceInfo.width}x${r.sourceInfo.height} ${r.sourceInfo.fps} ${r.sourceInfo.duration.toFixed(1)}s, ${r.sourceLoudness?.integratedLufs ?? '–'} LUFS)`);
      for (const w of r.warnings) console.log(`  ! ${w}`);
      for (const x of r.results) {
        console.log(`  ${x.platform.padEnd(15)} ${String(x.info.sizeMB).padStart(6)} MB  ${x.videoKbps}k  ${x.loudness ? `${x.loudness.integratedLufs} LUFS ${x.loudness.truePeakDbtp} dBTP` : 'no audio'}  ${x.problems.length ? 'PROBLEM: ' + x.problems.join('; ') : 'ok'}`);
      }
    } catch (error) {
      all.push({ source: file, error: error.message });
      console.log(`\n${path.basename(file)}: ${error.message}`);
    }
  }
  console.log('\n' + JSON.stringify({ ok: true, results: all }, null, 2));
}

main().catch((error) => {
  console.error(`platform-export: ${error.message}`);
  process.exit(1);
});
