/**
 * Review files beside a transcript. Cuts: <name>.cuts.json (machine, editable
 * `approved` flags) + <name>.cuts.md (review sheet), and <name>.keeps.json for
 * scripts/plan-cut.mjs once approved. Punch-ins: <name>.punchins.json + .md.
 * Shared by the edit tools and scripts/find-cuts.mjs.
 */

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CutOptions,
  CutSuggestion,
  CutSummary,
  cutsMarkdown,
  DEFAULT_KEEP_PAUSE_SECONDS,
  DEFAULT_MIN_PAUSE_SECONDS,
  findCuts,
  keepRanges,
  summarize,
  wordsFrom
} from './cleanup.js';
import {
  DEFAULT_EASE_SECONDS,
  DEFAULT_MAX_HOLD_SECONDS,
  DEFAULT_MIN_GAP_SECONDS,
  DEFAULT_PUNCH_SCALE_PERCENT,
  PunchIn,
  punchInsMarkdown,
  PunchOptions,
  suggestPunchIns
} from './punchins.js';
import { readBrollIndex } from '../broll/index.js';
import { checkHook, DEFAULT_SIMILARITY_THRESHOLD } from '../library/hooks.js';
import { listEntries } from '../library/index.js';
import { findShortCandidates, ShortCandidate, ShortOptions, shortsMarkdown } from './shorts.js';
import { BrollOptions, brollMarkdown, BrollSuggestion, suggestBroll } from '../broll/match.js';

export interface CutListFile {
  description: string;
  transcriptPath: string;
  durationSeconds: number;
  options: { minPauseSeconds: number; keepPauseSeconds: number };
  createdAt: string;
  summary: CutSummary;
  cuts: CutSuggestion[];
}

export function cutListBase(transcriptPath: string): string {
  return transcriptPath.replace(/(\.words)?\.json$/i, '');
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

export interface CreateResult {
  cutsJson: string;
  cutsMd: string;
  written: boolean;
  list: CutListFile;
}

/**
 * Builds the cut list. Writes it unless a .cuts.json already exists (it may hold
 * approvals someone edited) — pass force to replace it.
 */
export async function createCutList(
  transcriptPath: string,
  options: CutOptions = {},
  { write = true, force = false }: { write?: boolean; force?: boolean } = {}
): Promise<CreateResult> {
  const words = wordsFrom(JSON.parse(await readFile(transcriptPath, 'utf8')));
  if (words.length === 0) throw new Error(`No timed words in ${transcriptPath}`);
  const durationSeconds = options.durationSeconds ?? words[words.length - 1]!.end;
  const cuts = findCuts(words, options);
  const summary = summarize(cuts, durationSeconds);
  const base = cutListBase(transcriptPath);
  const list: CutListFile = {
    description: 'Optional silence/filler cut suggestions from WhisperX word timings. All start unapproved; set approved true on the ones to take, then run scripts/find-cuts.mjs --apply.',
    transcriptPath,
    durationSeconds,
    options: {
      minPauseSeconds: options.minPauseSeconds ?? DEFAULT_MIN_PAUSE_SECONDS,
      keepPauseSeconds: options.keepPauseSeconds ?? DEFAULT_KEEP_PAUSE_SECONDS
    },
    createdAt: new Date().toISOString(),
    summary,
    cuts
  };
  const cutsJson = `${base}.cuts.json`;
  const cutsMd = `${base}.cuts.md`;
  let written = false;
  if (write && (force || !existsSync(cutsJson))) {
    await writeAtomic(cutsJson, JSON.stringify(list, null, 2) + '\n');
    await writeAtomic(cutsMd, cutsMarkdown(path.basename(base), cuts, summary));
    written = true;
  }
  return { cutsJson, cutsMd, written, list };
}

export interface ApplyResult {
  keepsPath: string;
  approved: number[];
  removedSeconds: number;
  keptSeconds: number;
  keeps: Array<{ start: number; end: number }>;
}

/** Applies approve/reject overrides, then writes <name>.keeps.json for plan-cut. */
export async function applyCutList(
  cutsJsonPath: string,
  {
    approve = [],
    reject = [],
    approveCuts = false
  }: { approve?: number[]; reject?: number[]; /** Take every suggestion whose action is `cut`. */ approveCuts?: boolean } = {}
): Promise<ApplyResult> {
  const list: CutListFile = JSON.parse(await readFile(cutsJsonPath, 'utf8'));
  const ids = new Set(list.cuts.map((c) => c.id));
  for (const id of [...approve, ...reject]) if (!ids.has(id)) throw new Error(`No cut #${id} in ${cutsJsonPath}`);
  const cuts = list.cuts.map((c) => ({
    ...c,
    approved: reject.includes(c.id) ? false : approve.includes(c.id) || (approveCuts && c.action === 'cut') ? true : c.approved
  }));
  const keeps = keepRanges(cuts, list.durationSeconds);
  const keptSeconds = keeps.reduce((a, k) => a + (k.end - k.start), 0);
  const keepsPath = cutsJsonPath.replace(/\.cuts\.json$/i, '') + '.keeps.json';
  await writeAtomic(keepsPath, JSON.stringify(keeps, null, 2) + '\n');
  return {
    keepsPath,
    approved: cuts.filter((c) => c.approved).map((c) => c.id),
    removedSeconds: Math.round((list.durationSeconds - keptSeconds) * 1000) / 1000,
    keptSeconds: Math.round(keptSeconds * 1000) / 1000,
    keeps
  };
}

export interface PunchListFile {
  description: string;
  transcriptPath: string;
  scalePercent: number;
  options: Required<PunchOptions>;
  createdAt: string;
  punchIns: PunchIn[];
}

export function punchListPath(transcriptPath: string): string {
  return `${cutListBase(transcriptPath)}.punchins.json`;
}

/** Same rule as the cut list: an existing .punchins.json is kept unless force. */
export async function createPunchList(
  transcriptPath: string,
  options: PunchOptions & { scalePercent?: number } = {},
  { write = true, force = false }: { write?: boolean; force?: boolean } = {}
): Promise<{ jsonPath: string; mdPath: string; written: boolean; list: PunchListFile }> {
  const words = wordsFrom(JSON.parse(await readFile(transcriptPath, 'utf8')));
  if (words.length === 0) throw new Error(`No timed words in ${transcriptPath}`);
  const resolved: Required<PunchOptions> = {
    minGapSeconds: options.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS,
    easeSeconds: options.easeSeconds ?? DEFAULT_EASE_SECONDS,
    maxHoldSeconds: options.maxHoldSeconds ?? DEFAULT_MAX_HOLD_SECONDS,
    pauseSeconds: options.pauseSeconds ?? 0.6
  };
  const scalePercent = options.scalePercent ?? DEFAULT_PUNCH_SCALE_PERCENT;
  const list: PunchListFile = {
    description: 'Optional punch-in suggestions (eased Scale pushes) from WhisperX word timings. None are applied until chosen with apply_punch_ins.',
    transcriptPath,
    scalePercent,
    options: resolved,
    createdAt: new Date().toISOString(),
    punchIns: suggestPunchIns(words, resolved)
  };
  const jsonPath = punchListPath(transcriptPath);
  const mdPath = jsonPath.replace(/\.json$/, '.md');
  let written = false;
  if (write && (force || !existsSync(jsonPath))) {
    await writeAtomic(jsonPath, JSON.stringify(list, null, 2) + '\n');
    await writeAtomic(mdPath, punchInsMarkdown(path.basename(cutListBase(transcriptPath)), list.punchIns, scalePercent));
    written = true;
  }
  return { jsonPath, mdPath, written, list };
}

export interface BrollListFile {
  description: string;
  transcriptPath: string;
  libraryRoot: string;
  options: BrollOptions;
  createdAt: string;
  suggestions: BrollSuggestion[];
}

/** <name>.broll.json + .md beside the transcript; existing list kept unless force. */
export async function createBrollList(
  transcriptPath: string,
  privateDir: string,
  options: BrollOptions = {},
  { write = true, force = false }: { write?: boolean; force?: boolean } = {}
): Promise<{ jsonPath: string; mdPath: string; written: boolean; list: BrollListFile; libraryClips: number }> {
  const words = wordsFrom(JSON.parse(await readFile(transcriptPath, 'utf8')));
  const index = await readBrollIndex(privateDir);
  const list: BrollListFile = {
    description: 'Optional b-roll suggestions matched from the private b-roll tag index. Paths are relative to libraryRoot. None are placed until chosen.',
    transcriptPath,
    libraryRoot: index.root,
    options,
    createdAt: new Date().toISOString(),
    suggestions: suggestBroll(words, index.clips, options)
  };
  const base = cutListBase(transcriptPath);
  const jsonPath = `${base}.broll.json`;
  const mdPath = `${base}.broll.md`;
  let written = false;
  if (write && (force || !existsSync(jsonPath))) {
    await writeAtomic(jsonPath, JSON.stringify(list, null, 2) + '\n');
    await writeAtomic(mdPath, brollMarkdown(path.basename(base), list.suggestions));
    written = true;
  }
  return { jsonPath, mdPath, written, list, libraryClips: index.clips.length };
}

export interface ShortListFile {
  description: string;
  transcriptPath: string;
  transcriptSeconds: number;
  options: ShortOptions;
  createdAt: string;
  candidates: ShortCandidate[];
}

/**
 * <name>.shorts.json + .md beside the transcript; existing list kept unless force.
 * With a private dir, each hook is checked against the library's past hooks.
 */
export async function createShortList(
  transcriptPath: string,
  options: ShortOptions = {},
  { write = true, force = false, privateDir }: { write?: boolean; force?: boolean; privateDir?: string | undefined } = {}
): Promise<{ jsonPath: string; mdPath: string; written: boolean; list: ShortListFile; hooksCheckedAgainst: number }> {
  const words = wordsFrom(JSON.parse(await readFile(transcriptPath, 'utf8')));
  if (words.length === 0) throw new Error(`No timed words in ${transcriptPath}`);
  const entries = privateDir ? (await listEntries(privateDir)).entries : [];
  const candidates: ShortCandidate[] = findShortCandidates(words, options).map((c) => {
    if (!entries.length) return { ...c, closeTo: null };
    const check = checkHook(c.hook, entries, DEFAULT_SIMILARITY_THRESHOLD, 1);
    if (!check.tooClose) return { ...c, closeTo: null };
    return {
      ...c,
      score: Math.round((c.score - 2) * 1000) / 1000,
      reasons: [...c.reasons, 'too close to a past hook'],
      closeTo: check.closest[0]?.hookLine ?? null
    };
  });
  const list: ShortListFile = {
    description: 'Short candidates (30-60s native windows) ranked on the opening line. All unapproved; build chosen ids with build_short_sequences.',
    transcriptPath,
    transcriptSeconds: words[words.length - 1]!.end,
    options,
    createdAt: new Date().toISOString(),
    candidates
  };
  const base = cutListBase(transcriptPath);
  const jsonPath = `${base}.shorts.json`;
  const mdPath = `${base}.shorts.md`;
  let written = false;
  if (write && (force || !existsSync(jsonPath))) {
    await writeAtomic(jsonPath, JSON.stringify(list, null, 2) + '\n');
    await writeAtomic(mdPath, shortsMarkdown(path.basename(base), candidates));
    written = true;
  }
  return { jsonPath, mdPath, written, list, hooksCheckedAgainst: entries.length };
}
