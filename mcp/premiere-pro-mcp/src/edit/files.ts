/**
 * Cut-list files beside a transcript: <name>.cuts.json (machine, editable
 * `approved` flags) + <name>.cuts.md (review sheet), and <name>.keeps.json for
 * scripts/plan-cut.mjs once approved. Shared by the find_cuts tool and
 * scripts/find-cuts.mjs.
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
    description: 'Silence/filler cut suggestions from WhisperX word timings. Set approved true/false per cut, then run scripts/find-cuts.mjs --apply.',
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
  { approve = [], reject = [] }: { approve?: number[]; reject?: number[] } = {}
): Promise<ApplyResult> {
  const list: CutListFile = JSON.parse(await readFile(cutsJsonPath, 'utf8'));
  const ids = new Set(list.cuts.map((c) => c.id));
  for (const id of [...approve, ...reject]) if (!ids.has(id)) throw new Error(`No cut #${id} in ${cutsJsonPath}`);
  const cuts = list.cuts.map((c) => ({
    ...c,
    approved: approve.includes(c.id) ? true : reject.includes(c.id) ? false : c.approved
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
