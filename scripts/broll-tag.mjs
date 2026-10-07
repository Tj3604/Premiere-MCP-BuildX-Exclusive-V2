#!/usr/bin/env node
/**
 * Build / extend the private b-roll tag index ($BUILDX_PRIVATE_DIR/broll/index.json).
 *
 * 1. Index:  node scripts/broll-tag.mjs "<MASTER BROLL FOLDER>"
 *            Tags every .mp4/.mov from its folders and filename. Reads names only,
 *            so nothing downloads from Dropbox. Skips _OLD_* folders. Rebuilding
 *            keeps visual tags and probed orientation.
 *
 * 2. Look (optional, downloads):  node scripts/broll-tag.mjs --frames "ADU/FINISHED/817_INTERIOR" [--limit 40]
 *            For clips under that subfolder: ffprobe orientation (rotation-aware) and
 *            one mid-clip frame into private/broll/frames/, plus a numbered contact
 *            sheet to look at. Use it on generic names like X1251_INTERIOR_33.
 *
 * 3. Tag:    node scripts/broll-tag.mjs --set-tags "ADU/FINISHED/X1251_INTERIOR_33.mp4" kitchen,island
 *            Adds visual tags (and the concepts they map to) to one clip.
 *
 * Needs `npm run build` in mcp/premiere-pro-mcp.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/dist');

function parseArgs(argv) {
  const args = { limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--frames') args.frames = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--set-tags') {
      args.setTags = argv[++i];
      args.tags = argv[++i];
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.root = a;
  }
  return args;
}

async function walk(dir, root, out = []) {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.') || /^_OLD_/i.test(d.name)) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) await walk(full, root, out);
    else if (/\.(mp4|mov)$/i.test(d.name)) out.push(path.relative(root, full));
  }
  return out;
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await rename(tmp, file);
}

function probeOrientation(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', file],
    { encoding: 'utf8' }
  );
  const s = JSON.parse(out).streams?.[0] ?? {};
  const rotation = Math.abs(Number(s.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? 0));
  let { width, height } = s;
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  return { orientation: width > height ? 'horizontal' : 'vertical', width, height, rotation };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(DIST, 'broll/index.js'))) throw new Error('mcp/premiere-pro-mcp is not built — run `npm run build` there first.');
  const broll = await import(pathToFileURL(path.join(DIST, 'broll/index.js')).href);
  const library = await import(pathToFileURL(path.join(DIST, 'library/index.js')).href);
  const privateDir = library.resolvePrivateDir(process.env, path.join(PROJECT_ROOT, 'private'));
  const indexFile = broll.brollIndexPath(privateDir);
  const existing = existsSync(indexFile) ? JSON.parse(await readFile(indexFile, 'utf8')) : null;

  if (args.root) {
    const root = path.resolve(args.root);
    const previous = new Map((existing?.clips ?? []).map((c) => [c.path, c]));
    const files = (await walk(root, root)).sort();
    const clips = files.map((rel) => broll.buildClip(rel, previous.get(rel.split(path.sep).join('/'))));
    const generic = clips.filter((c) => c.tags.every((t) => ['adu', 'finished', 'interior', 'exterior', 'drone', 'aerial', 'construction'].includes(t)));
    await writeJsonAtomic(indexFile, {
      description: 'Private b-roll tag index: one row per library clip, tags from folder/file names plus visual tags. Built by scripts/broll-tag.mjs.',
      root,
      builtAt: new Date().toISOString(),
      clips
    });
    const flagged = clips.filter((c) => c.flags.length);
    console.log(
      JSON.stringify(
        {
          ok: true,
          index: indexFile,
          clips: clips.length,
          flagged: flagged.length,
          knownVertical: clips.filter((c) => c.orientation === 'vertical').length,
          orientationUnchecked: clips.filter((c) => c.orientation === null).length,
          genericNames: generic.length,
          genericExamples: generic.slice(0, 5).map((c) => c.path),
          note: generic.length ? 'Generic names match only by folder (e.g. "interior"). Run --frames on a folder to look and add tags.' : undefined
        },
        null,
        2
      )
    );
    return;
  }

  if (!existing) throw new Error(`No index at ${indexFile} — build it first with: node scripts/broll-tag.mjs "<MASTER BROLL FOLDER>"`);

  if (args.setTags) {
    const clip = existing.clips.find((c) => c.path === args.setTags);
    if (!clip) throw new Error(`No clip "${args.setTags}" in the index (paths are relative to ${existing.root}).`);
    const given = String(args.tags ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!given.length) throw new Error('Pass tags as a comma list, e.g. kitchen,island');
    clip.visualTags = [...new Set([...clip.visualTags, ...given, ...given.flatMap(broll.conceptsFor)])];
    await writeJsonAtomic(indexFile, existing);
    console.log(JSON.stringify({ ok: true, path: clip.path, visualTags: clip.visualTags }, null, 2));
    return;
  }

  if (args.frames) {
    // A folder ("ADU/FINISHED") or a name prefix ("ADU/FINISHED/817_INTERIOR").
    const prefix = args.frames;
    const chosen = existing.clips.filter((c) => c.path.startsWith(prefix)).slice(0, args.limit);
    if (!chosen.length) throw new Error(`No clips under "${prefix}"`);
    const framesDir = path.join(privateDir, 'broll', 'frames');
    await mkdir(framesDir, { recursive: true });
    const made = [];
    for (const [n, clip] of chosen.entries()) {
      const src = path.join(existing.root, clip.path);
      try {
        Object.assign(clip, { orientation: probeOrientation(src).orientation });
        const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' }).trim());
        const out = path.join(framesDir, clip.path.replace(/[\\/]/g, '__').replace(/\.[a-z0-9]+$/i, '.jpg'));
        execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String((dur || 2) / 2), '-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', '-y', out]);
        made.push({ n: n + 1, path: clip.path, orientation: clip.orientation, frame: out });
      } catch (error) {
        made.push({ n: n + 1, path: clip.path, error: String(error.message).split('\n')[0] });
      }
    }
    await writeJsonAtomic(indexFile, existing);
    const ok = made.filter((m) => m.frame);
    const sheet = path.join(framesDir, `sheet-${args.frames.replace(/[^a-z0-9]+/gi, '_')}.jpg`);
    if (ok.length === 1) execFileSync('cp', [ok[0].frame, sheet]);
    else if (ok.length) {
      const inputs = ok.flatMap((m) => ['-i', m.frame]);
      const cols = Math.min(6, ok.length);
      const cells = ok.map((m, i) => `[${i}]scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2,drawbox=0:0:44:30:black@0.8:t=fill[c${i}]`);
      // No drawtext in this ffmpeg build — the numbered list below maps cells to clips, row by row.
      const layout = ok.map((_, i) => `${(i % cols) * 320}_${Math.floor(i / cols) * 320}`).join('|');
      execFileSync('ffmpeg', ['-nostdin', '-v', 'error', ...inputs, '-filter_complex', `${cells.join(';')};${ok.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${ok.length}:layout=${layout}:fill=black`, '-frames:v', '1', '-y', sheet]);
    }
    console.log(JSON.stringify({ ok: true, sheet: ok.length ? sheet : null, columns: Math.min(6, ok.length), clips: made }, null, 2));
  }
}

main().catch((error) => {
  console.error(`broll-tag: ${error.message}`);
  process.exit(1);
});
