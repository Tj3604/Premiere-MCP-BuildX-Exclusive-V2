#!/usr/bin/env node
/**
 * Add one finished video to the BuildX library.
 *
 * Writes $BUILDX_PRIVATE_DIR/library/entries/<slug>.json (default <repo>/private,
 * which is gitignored — entries hold customer names and performance data, and the
 * repo is public). Schema: knowledge/library/video-entry.schema.json.
 *
 * Measured from the files, never typed in:
 *   lengthSeconds  ffprobe on the export
 *   cutCount       scripts/detect-scenes.mjs (PySceneDetect adaptive) on the export
 *   hookLine       first sentence of the WhisperX words.json, split by the same
 *                  rule transcribe-x.mjs uses for its .md
 *
 * Everything that can't be read from the files starts null/empty and is filled with
 * --set (or later, once the video is published and has numbers).
 *
 * Usage:
 *   node scripts/library-add.mjs <export.mp4> --transcript <name.words.json> \
 *        --slug <kebab-slug> --title "<Title>" [options]
 *     --graphics a,b,c        graphic types on screen (thumbnail-card,logo,end-card,…)
 *     --caption-style <name>  e.g. "Thomas Default"
 *     --set key=value         any field, dotted for nesting; repeatable.
 *                             e.g. --set publishDate=2026-10-06
 *                                  --set platformLinks.youtube=https://…
 *                                  --set performance.views7d=1200
 *     --cuts <n>              skip scene detection and use this count
 *     --no-cut-detect         skip scene detection, cutCount = null
 *     --dry-run               print the entry, write nothing
 *
 * Refuses to overwrite an existing entry. Needs `npm run build` in
 * mcp/premiere-pro-mcp first — validation is the server's own validateEntry.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY_DIST = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/dist/library/index.js');

// Must match transcribe-x.mjs, so the hook line is a line of its .md.
const PAUSE_SPLIT_SECONDS = 0.6;

function parseArgs(argv) {
  const args = { set: [], cutDetect: true, dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--transcript': args.transcript = argv[++i]; break;
      case '--slug': args.slug = argv[++i]; break;
      case '--title': args.title = argv[++i]; break;
      case '--graphics': args.graphics = argv[++i]; break;
      case '--caption-style': args.captionStyle = argv[++i]; break;
      case '--set': args.set.push(argv[++i]); break;
      case '--cuts': args.cuts = Number(argv[++i]); break;
      case '--no-cut-detect': args.cutDetect = false; break;
      case '--dry-run': args.dryRun = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
        rest.push(a);
    }
  }
  args.input = rest[0];
  return args;
}

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))
    );
  });
}

async function probeDuration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const seconds = Number(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe gave no duration for ${file}`);
  return Number(seconds.toFixed(3));
}

async function detectCuts(file) {
  const out = await run('node', [path.join(PROJECT_ROOT, 'scripts/detect-scenes.mjs'), file]);
  const result = JSON.parse(out);
  if (!Number.isInteger(result.cutCount)) throw new Error('detect-scenes returned no cutCount');
  return result.cutCount;
}

function firstSentence(words) {
  const picked = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    picked.push(String(word.text).trim());
    const next = words[i + 1];
    const endsSentence = /[.!?]"?$/.test(String(word.text).trim());
    const pauseAfter = next ? next.start - word.end : Infinity;
    const speakerChanges = next ? next.speaker !== word.speaker : false;
    if (endsSentence || pauseAfter >= PAUSE_SPLIT_SECONDS || speakerChanges) break;
  }
  return picked.filter(Boolean).join(' ');
}

function coerce(raw) {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function applySet(entry, assignment) {
  const eq = assignment.indexOf('=');
  if (eq < 1) throw new Error(`--set needs key=value, got '${assignment}'`);
  const keys = assignment.slice(0, eq).split('.');
  const value = coerce(assignment.slice(eq + 1));
  let target = entry;
  for (const key of keys.slice(0, -1)) {
    if (typeof target[key] !== 'object' || target[key] === null) {
      throw new Error(`--set ${keys.join('.')}: '${key}' is not an object field`);
    }
    target = target[key];
  }
  const leaf = keys[keys.length - 1];
  if (!(leaf in target) && target !== entry.platformLinks) {
    throw new Error(`--set ${keys.join('.')}: unknown field`);
  }
  target[leaf] = value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.transcript || !args.slug || !args.title) {
    console.error('Usage: node scripts/library-add.mjs <export.mp4> --transcript <words.json> --slug <slug> --title "<Title>"');
    process.exit(2);
  }
  if (!existsSync(LIBRARY_DIST)) {
    throw new Error('mcp/premiere-pro-mcp is not built — run `npm run build` there first.');
  }
  const library = await import(pathToFileURL(LIBRARY_DIST).href);

  const exportPath = path.resolve(args.input);
  const transcriptPath = path.resolve(args.transcript);
  if (!existsSync(exportPath)) throw new Error(`Export not found: ${exportPath}`);
  if (!existsSync(transcriptPath)) throw new Error(`Transcript not found: ${transcriptPath}`);
  if (!library.isValidSlug(args.slug)) throw new Error(`Slug must be lowercase kebab-case: '${args.slug}'`);

  const privateDir = library.resolvePrivateDir(process.env, path.join(PROJECT_ROOT, 'private'));
  const dir = library.entriesDir(privateDir);
  const outPath = path.join(dir, `${args.slug}.json`);
  if (existsSync(outPath)) throw new Error(`Entry already exists, not overwriting: ${outPath}`);

  const words = JSON.parse(await readFile(transcriptPath, 'utf8'));
  if (!Array.isArray(words) || words.length === 0) throw new Error('Transcript has no words — is it a WhisperX .words.json?');

  const lengthSeconds = await probeDuration(exportPath);
  let cutCount = null;
  if (Number.isInteger(args.cuts)) cutCount = args.cuts;
  else if (args.cutDetect) cutCount = await detectCuts(exportPath);

  const entry = {
    schemaVersion: library.LIBRARY_SCHEMA_VERSION,
    slug: args.slug,
    title: args.title,
    hookLine: firstSentence(words),
    transcriptPath,
    lengthSeconds,
    cutCount,
    graphicsUsed: args.graphics ? args.graphics.split(',').map((g) => g.trim()).filter(Boolean) : [],
    captionStyle: args.captionStyle ?? null,
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
    exportPath,
    addedAt: new Date().toISOString()
  };
  for (const assignment of args.set) applySet(entry, assignment);

  const problems = library.validateEntry(entry);
  if (problems.length > 0) throw new Error(`Entry is invalid:\n  ${problems.join('\n  ')}`);

  const json = JSON.stringify(entry, null, 2) + '\n';
  if (args.dryRun) {
    process.stdout.write(json);
    return;
  }
  await mkdir(dir, { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  await writeFile(tmp, json);
  await rename(tmp, outPath);
  console.log(JSON.stringify({ ok: true, slug: entry.slug, path: outPath, uri: `buildx://library/entry/${entry.slug}` }, null, 2));
}

main().catch((error) => {
  console.error(`library-add: ${error.message}`);
  process.exit(1);
});
