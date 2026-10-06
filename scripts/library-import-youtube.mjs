#!/usr/bin/env node
/**
 * Put YouTube Studio numbers into the BuildX library.
 *
 * Export from Studio: Analytics -> Advanced mode -> tick "Stayed to watch" and
 * "Average percentage viewed" -> Export current view -> CSV. Unzip and pass
 * Table data.csv. (Recipe and traps: reference_youtube_studio_hook_metrics.)
 *
 * For each row: views go to views7d or views30d (--window), plus average view
 * duration, average percentage viewed (retentionPercent) and stayed-to-watch when
 * those columns exist. Fills publishDate and the YouTube link if the entry has
 * none, so the next import matches by video ID instead of by title.
 *
 * Matching: video ID if the entry already has the link, else a fuzzy title match
 * that refuses to guess when two entries score alike. Unmatched rows are listed
 * with their best candidates — fix with library-add's --set, or rename the
 * library title.
 *
 * Usage:
 *   node scripts/library-import-youtube.mjs "<Table data.csv>" --window 7d|30d \
 *        [--as-of YYYY-MM-DD] [--dry-run]
 *
 * Only performance fields, publishDate and platformLinks.youtube are written.
 * Needs `npm run build` in mcp/premiere-pro-mcp.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PROJECT_ROOT, 'mcp/premiere-pro-mcp/dist/library');

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--window') args.window = argv[++i];
    else if (a === '--as-of') args.asOf = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.csv = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv || !['7d', '30d'].includes(args.window)) {
    console.error('Usage: node scripts/library-import-youtube.mjs "<Table data.csv>" --window 7d|30d [--as-of YYYY-MM-DD] [--dry-run]');
    process.exit(2);
  }
  const asOf = args.asOf ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`--as-of must be YYYY-MM-DD, got ${asOf}`);
  if (!existsSync(path.join(DIST, 'youtube.js'))) {
    throw new Error('mcp/premiere-pro-mcp is not built — run `npm run build` there first.');
  }
  const library = await import(pathToFileURL(path.join(DIST, 'index.js')).href);
  const youtube = await import(pathToFileURL(path.join(DIST, 'youtube.js')).href);

  const { rows, columns } = youtube.readStudioTable(await readFile(path.resolve(args.csv), 'utf8'));
  const privateDir = library.resolvePrivateDir(process.env, path.join(PROJECT_ROOT, 'private'));
  const { entries } = await library.listEntries(privateDir);
  if (entries.length === 0) throw new Error(`Library at ${privateDir} is empty.`);

  const matches = youtube.matchRows(rows, entries);
  // Two rows landing on one entry means the title match was wrong for one of them.
  const claims = new Map();
  for (const m of matches) if (m.entry) claims.set(m.entry.slug, (claims.get(m.entry.slug) ?? 0) + 1);

  const updated = [];
  const unmatched = [];
  const conflicts = [];
  for (const m of matches) {
    if (!m.entry) {
      unmatched.push({ title: m.row.title, views: m.row.views, candidates: m.candidates });
      continue;
    }
    if (claims.get(m.entry.slug) > 1) {
      conflicts.push({ title: m.row.title, slug: m.entry.slug });
      continue;
    }
    const next = youtube.applyStudioRow(m.entry, m.row, args.window, asOf);
    const problems = library.validateEntry(next);
    if (problems.length > 0) {
      unmatched.push({ title: m.row.title, views: m.row.views, candidates: [], error: problems.join('; ') });
      continue;
    }
    if (!args.dryRun) {
      const out = path.join(library.entriesDir(privateDir), `${next.slug}.json`);
      const tmp = `${out}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify(next, null, 2) + '\n');
      await rename(tmp, out);
    }
    updated.push({
      slug: next.slug,
      youtubeTitle: m.row.title,
      matchedBy: m.how,
      score: m.score,
      views: m.row.views,
      retentionPercent: next.performance.retentionPercent,
      stayedToWatchPercent: next.performance.stayedToWatchPercent
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: args.dryRun,
        window: args.window,
        asOf,
        columns,
        rows: rows.length,
        updated: updated.length,
        unmatched: unmatched.length,
        conflicts: conflicts.length,
        updatedEntries: updated,
        unmatchedRows: unmatched,
        conflictRows: conflicts
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`library-import-youtube: ${error.message}`);
  process.exit(1);
});
