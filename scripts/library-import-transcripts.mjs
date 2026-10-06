#!/usr/bin/env node
/**
 * Backfill the BuildX library from transcripts that already sit next to delivered
 * videos — WITHOUT opening the videos.
 *
 * The delivery folder is Dropbox online-only: opening a video downloads it. So:
 *   lengthSeconds  Spotlight (`mdls kMDItemDurationSeconds`), which reads the index,
 *                  not the file
 *   hookLine       first sentence of the sidecar transcript
 *   cutCount       null — needs the picture; run library-add.mjs on a local export
 *                  when you want it
 *
 * Transcript lookup per video, first hit wins, filename case-insensitive, in the
 * video's folder, a sibling Transcripts/ folder, or ../Transcripts/:
 *   <base>_words.json, <base>.srt, <base>_timecoded.txt, <base>.json, <base>.txt
 * then the same again with re-export tails dropped from <base> ("_1", " fixed",
 * " V3", " Copy 01").
 *
 * Videos with no transcript (carousels, photo recaps, music-only pieces) are
 * reported and skipped. Videos already in the library (same exportPath) are skipped.
 * Never overwrites an entry.
 *
 * Usage:
 *   node scripts/library-import-transcripts.mjs <delivery-root> [--dry-run] [--include-archives]
 *     Top-level folders starting with z/Z (archives) are skipped unless --include-archives.
 *
 * Needs `npm run build` in mcp/premiere-pro-mcp (it reuses the server's parsers
 * and validation so the two can't drift).
 */

import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/dist/library');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v']);
const TRANSCRIPT_SUFFIXES = ['_words.json', '.srt', '_timecoded.txt', '.json', '.txt'];

function parseArgs(argv) {
  const args = { dryRun: false, includeArchives: false };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--include-archives') args.includeArchives = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.root = a;
  }
  return args;
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function* walk(dir, depth = 0, opts) {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (depth === 0 && !opts.includeArchives && /^z/i.test(item.name)) continue;
      yield* walk(full, depth + 1, opts);
    } else if (VIDEO_EXT.has(path.extname(item.name).toLowerCase())) {
      yield full;
    }
  }
}

const dirListings = new Map();
async function listLower(dir) {
  if (!dirListings.has(dir)) {
    let names = [];
    try {
      names = await readdir(dir);
    } catch {}
    dirListings.set(dir, new Map(names.map((n) => [n.toLowerCase(), n])));
  }
  return dirListings.get(dir);
}

// Re-export tails that don't appear on the transcript: "_1", " fixed", " V3", " Copy 01".
const VERSION_TAIL = /(?:_\d+| fixed| v\d+| copy \d+)$/i;

function baseCandidates(base) {
  const out = [base];
  let b = base;
  while (VERSION_TAIL.test(b)) {
    b = b.replace(VERSION_TAIL, '');
    out.push(b);
  }
  return out;
}

async function findTranscript(videoPath) {
  const dir = path.dirname(videoPath);
  const dirs = [dir, path.join(dir, 'Transcripts'), path.join(dir, '..', 'Transcripts')];
  for (const base of baseCandidates(path.basename(videoPath, path.extname(videoPath)))) {
    for (const suffix of TRANSCRIPT_SUFFIXES) {
      const wanted = `${base}${suffix}`.toLowerCase();
      for (const d of dirs) {
        const hit = (await listLower(d)).get(wanted);
        if (hit) return path.join(d, hit);
      }
    }
  }
  return null;
}

async function spotlightDuration(file) {
  try {
    const { stdout } = await run('mdls', ['-raw', '-name', 'kMDItemDurationSeconds', file]);
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? Number(seconds.toFixed(3)) : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) {
    console.error('Usage: node scripts/library-import-transcripts.mjs <delivery-root> [--dry-run] [--include-archives]');
    process.exit(2);
  }
  if (!existsSync(path.join(DIST, 'index.js'))) {
    throw new Error('mcp/premiere-pro-mcp is not built — run `npm run build` there first.');
  }
  const library = await import(pathToFileURL(path.join(DIST, 'index.js')).href);
  const transcripts = await import(pathToFileURL(path.join(DIST, 'transcript.js')).href);

  const root = path.resolve(args.root);
  const privateDir = library.resolvePrivateDir(process.env, path.join(PROJECT_ROOT, 'private'));
  const outDir = library.entriesDir(privateDir);

  const { entries: existing } = await library.listEntries(privateDir);
  const knownExports = new Set(existing.map((e) => path.resolve(e.exportPath)));
  const usedSlugs = new Set(existing.map((e) => e.slug));
  if (existsSync(outDir)) for (const f of await readdir(outDir)) usedSlugs.add(f.replace(/\.json$/, ''));

  const added = [];
  const skipped = [];
  for await (const video of walk(root, 0, args)) {
    const rel = path.relative(root, video);
    if (knownExports.has(path.resolve(video))) {
      skipped.push({ video: rel, reason: 'already in library' });
      continue;
    }
    const transcriptPath = await findTranscript(video);
    if (!transcriptPath) {
      skipped.push({ video: rel, reason: 'no transcript' });
      continue;
    }
    let text;
    try {
      text = await transcripts.readTranscriptText(transcriptPath);
    } catch (error) {
      skipped.push({ video: rel, reason: `unreadable transcript: ${error.message}` });
      continue;
    }
    if (!text) {
      skipped.push({ video: rel, reason: 'empty transcript' });
      continue;
    }
    const lengthSeconds = await spotlightDuration(video);
    if (lengthSeconds === null) {
      skipped.push({ video: rel, reason: 'no duration in Spotlight' });
      continue;
    }

    const title = path.basename(video, path.extname(video));
    const top = rel.includes(path.sep) ? rel.split(path.sep)[0] : '';
    let slug = slugify(top ? `${top} ${title}` : title).slice(0, 90).replace(/-+$/, '');
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${slug.replace(/-\d+$/, '')}-${n}`;
    usedSlugs.add(slug);

    const entry = {
      schemaVersion: library.LIBRARY_SCHEMA_VERSION,
      slug,
      title,
      hookLine: transcripts.firstSentence(text),
      transcriptPath,
      lengthSeconds,
      cutCount: null,
      graphicsUsed: [],
      captionStyle: null,
      platformLinks: { youtube: null, instagram: null, tiktok: null, facebook: null },
      publishDate: null,
      performance: {
        views7d: null,
        views30d: null,
        avgViewDurationSeconds: null,
        retentionPercent: null,
        stayedToWatchPercent: null,
        measuredAt: null
      },
      exportPath: video,
      addedAt: new Date().toISOString()
    };
    const problems = library.validateEntry(entry);
    if (problems.length > 0) {
      skipped.push({ video: rel, reason: `invalid: ${problems.join('; ')}` });
      continue;
    }
    if (!args.dryRun) {
      await mkdir(outDir, { recursive: true });
      const out = path.join(outDir, `${slug}.json`);
      const tmp = `${out}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify(entry, null, 2) + '\n');
      await rename(tmp, out);
    }
    added.push({ slug, video: rel, transcript: path.relative(root, transcriptPath), lengthSeconds });
  }

  const reasons = {};
  for (const s of skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  console.log(
    JSON.stringify(
      { ok: true, dryRun: args.dryRun, privateDir, added: added.length, skipped: skipped.length, skippedByReason: reasons, addedEntries: added, skippedVideos: skipped },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`library-import-transcripts: ${error.message}`);
  process.exit(1);
});
