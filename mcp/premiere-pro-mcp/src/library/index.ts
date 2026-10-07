/**
 * BuildX video library — read side.
 *
 * One JSON file per finished video at <privateDir>/library/entries/<slug>.json.
 * privateDir comes from BUILDX_PRIVATE_DIR and is gitignored: entries carry
 * customer names, transcripts and performance numbers, and the repo is public.
 *
 * Schema: knowledge/library/video-entry.schema.json. Entries are written by
 * scripts/library-add.mjs; nothing in the server writes them.
 *
 * Deliberately free of import.meta so the resources test suite can load it —
 * callers pass resolved directories in.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const LIBRARY_SCHEMA_VERSION = 1;

export interface PlatformLinks {
  youtube?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
}

export interface VideoPerformance {
  views7d: number | null;
  views30d: number | null;
  avgViewDurationSeconds: number | null;
  retentionPercent: number | null;
  stayedToWatchPercent: number | null;
  measuredAt: string | null;
}

export interface VideoEntry {
  schemaVersion: 1;
  slug: string;
  title: string;
  hookLine: string;
  transcriptPath: string;
  lengthSeconds: number;
  cutCount: number | null;
  graphicsUsed: string[];
  captionStyle: string | null;
  platformLinks: PlatformLinks;
  publishDate: string | null;
  performance: VideoPerformance;
  exportPath: string;
  addedAt: string;
}

/** The compact row the index resource returns — enough to pick an entry to open. */
export interface LibraryIndexRow {
  slug: string;
  uri: string;
  title: string;
  hookLine: string;
  lengthSeconds: number;
  publishDate: string | null;
  views30d: number | null;
  stayedToWatchPercent: number | null;
}

export const LIBRARY_ENTRY_URI_PREFIX = 'buildx://library/entry/';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug);
}

/** BUILDX_PRIVATE_DIR wins; otherwise the caller's default (normally <repo>/private). */
export function resolvePrivateDir(env: NodeJS.ProcessEnv, fallback: string): string {
  const fromEnv = env.BUILDX_PRIVATE_DIR?.trim();
  return path.resolve(fromEnv ? fromEnv : fallback);
}

export function entriesDir(privateDir: string): string {
  return path.join(privateDir, 'library', 'entries');
}

/** Returns a list of problems; empty means the entry is usable. */
export function validateEntry(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null) return ['entry is not an object'];
  const e = value as Record<string, unknown>;
  const need = (key: string, ok: boolean, what: string) => {
    if (!ok) problems.push(`${key}: expected ${what}`);
  };
  const nullableNum = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
  const nullableStr = (v: unknown) => v === null || typeof v === 'string';

  need('schemaVersion', e.schemaVersion === LIBRARY_SCHEMA_VERSION, `${LIBRARY_SCHEMA_VERSION}`);
  need('slug', typeof e.slug === 'string' && isValidSlug(e.slug), 'kebab-case string');
  need('title', typeof e.title === 'string' && e.title.length > 0, 'non-empty string');
  need('hookLine', typeof e.hookLine === 'string', 'string');
  need('transcriptPath', typeof e.transcriptPath === 'string', 'string');
  need('lengthSeconds', typeof e.lengthSeconds === 'number' && e.lengthSeconds >= 0, 'number >= 0');
  need('cutCount', e.cutCount === null || Number.isInteger(e.cutCount), 'integer or null');
  need(
    'graphicsUsed',
    Array.isArray(e.graphicsUsed) && e.graphicsUsed.every((g) => typeof g === 'string'),
    'string array'
  );
  need('captionStyle', nullableStr(e.captionStyle), 'string or null');
  need('platformLinks', typeof e.platformLinks === 'object' && e.platformLinks !== null, 'object');
  need('publishDate', nullableStr(e.publishDate), 'YYYY-MM-DD or null');
  need('exportPath', typeof e.exportPath === 'string', 'string');
  need('addedAt', typeof e.addedAt === 'string', 'ISO timestamp');

  const p = e.performance as Record<string, unknown> | undefined;
  if (typeof p !== 'object' || p === null) {
    problems.push('performance: expected object');
  } else {
    for (const key of ['views7d', 'views30d', 'avgViewDurationSeconds', 'retentionPercent', 'stayedToWatchPercent']) {
      need(`performance.${key}`, nullableNum(p[key]), 'number or null');
    }
    need('performance.measuredAt', nullableStr(p.measuredAt), 'YYYY-MM-DD or null');
  }
  return problems;
}

export async function readEntry(privateDir: string, slug: string): Promise<VideoEntry> {
  if (!isValidSlug(slug)) throw new Error(`Invalid library slug '${slug}'`);
  const file = path.join(entriesDir(privateDir), `${slug}.json`);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(`No library entry '${slug}' in ${entriesDir(privateDir)}`);
  }
  const parsed: unknown = JSON.parse(raw);
  const problems = validateEntry(parsed);
  if (problems.length > 0) throw new Error(`Library entry '${slug}' is invalid: ${problems.join('; ')}`);
  return parsed as VideoEntry;
}

/**
 * Every valid entry, oldest first. Invalid files are reported, not thrown, so one
 * bad hand edit doesn't hide the rest of the library.
 */
export async function listEntries(privateDir: string): Promise<{ entries: VideoEntry[]; skipped: string[] }> {
  let files: string[];
  try {
    files = (await readdir(entriesDir(privateDir))).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { entries: [], skipped: [] };
  }
  const entries: VideoEntry[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const slug = file.slice(0, -'.json'.length);
    try {
      entries.push(await readEntry(privateDir, slug));
    } catch (error) {
      skipped.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  entries.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  return { entries, skipped };
}

export function toIndexRow(entry: VideoEntry): LibraryIndexRow {
  return {
    slug: entry.slug,
    uri: `${LIBRARY_ENTRY_URI_PREFIX}${entry.slug}`,
    title: entry.title,
    hookLine: entry.hookLine,
    lengthSeconds: entry.lengthSeconds,
    publishDate: entry.publishDate,
    views30d: entry.performance.views30d,
    stayedToWatchPercent: entry.performance.stayedToWatchPercent
  };
}
