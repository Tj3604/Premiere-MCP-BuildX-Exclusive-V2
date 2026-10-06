/**
 * B-roll tag index. Built from the library's folder and file names (no
 * downloads), plus optional tags added by looking at a frame. Lives in
 * $BUILDX_PRIVATE_DIR/broll/index.json — filenames carry customer surnames.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface BrollClip {
  /** Path relative to the library root, forward slashes. */
  path: string;
  /** Tags from folders and the filename, plus the concepts they map to. */
  tags: string[];
  /** Tags added by looking at a frame (broll-tag.mjs --set-tags). Kept across rebuilds. */
  visualTags: string[];
  /** Reasons the clip needs care before client use. */
  flags: string[];
  /** Known from the name or a probe; null until checked. */
  orientation: 'horizontal' | 'vertical' | null;
}

export interface BrollIndex {
  description: string;
  root: string;
  builtAt: string;
  clips: BrollClip[];
}

/**
 * Concept -> words that mean it. A clip or transcript word maps to every concept
 * that lists it; matching runs on concepts, so "studs" finds FRAMING clips.
 * Per terminology.md, BuildX walls are thin coat plaster — "drywall" in a
 * filename still maps to walls, it is never written on screen.
 */
export const CONCEPTS: Record<string, string[]> = {
  kitchen: ['kitchen', 'kitchens', 'cabinet', 'cabinets', 'countertop', 'countertops', 'island', 'appliances'],
  bathroom: ['bathroom', 'bathrooms', 'bath', 'shower', 'vanity', 'tile', 'toilet'],
  bedroom: ['bedroom', 'bedrooms', 'closet'],
  living: ['living', 'livingroom', 'family', 'lounge'],
  interior: ['interior', 'inside', 'room', 'rooms'],
  exterior: ['exterior', 'outside', 'siding', 'curb', 'facade'],
  porch: ['porch', 'deck', 'patio'],
  framing: ['framing', 'frame', 'framed', 'studs', 'stud', 'studwalls', 'trusses', 'truss', 'sheathing', 'wallraise', 'wallframing', 'floorframing', 'floordeck', 'gable', 'nailer', 'carpentry'],
  walls: ['walls', 'wall', 'plaster', 'drywall', 'drywallroom', 'drywallwalk', 'zipwall', 'zip'],
  foundation: ['foundation', 'foundations', 'footing', 'footings', 'slab', 'concrete', 'pour', 'basement'],
  sitework: ['sitework', 'excavation', 'excavator', 'excavators', 'dig', 'digging', 'trench', 'grading', 'stumpremoval', 'dumptruck', 'land', 'yard', 'equipment'],
  septic: ['septic', 'leach', 'perc', 'percolation', 'title5', 'wastewater'],
  electrical: ['electrical', 'electric', 'electrician', 'wiring', 'wire', 'panel', 'breaker', 'breakerpanel', 'roughin', 'outlet', 'outlets', 'ceilingbox', 'ceilingboxes', 'service', 'meter'],
  hvac: ['hvac', 'minisplit', 'heatpump', 'heating', 'cooling', 'vent', 'ventunit', 'ceilingventunit'],
  insulation: ['insulation', 'insulationdelivery', 'spray', 'foam'],
  windows: ['window', 'windows', 'windowwall', 'doors', 'door', 'doorway'],
  roof: ['roof', 'roofing', 'shingles'],
  garage: ['garage', 'garagebay'],
  stairs: ['stairs', 'stair', 'stairframing', 'staircase'],
  pool: ['pool'],
  aerial: ['drone', 'aerial', 'overhead', 'topdown', 'bird'],
  timelapse: ['timelapse', 'tl'],
  crew: ['crew', 'crews', 'staff', 'team', 'crewtalk', 'teamphotoday', 'contractor', 'builders', 'subcontractor'],
  owner: ['buz'],
  customer: ['customer', 'customers', 'client', 'clients', 'homeowner', 'homeowners', 'walkwithclient', 'family'],
  tour: ['hometour', 'tour', 'walkthrough', 'openhouse', 'walk', 'showing'],
  plans: ['plans', 'plan', 'planssreview', 'plansreview', 'siteplan', 'siteplancloseup', 'floorplan', 'floorplans', 'blueprint', 'blueprints', 'design', 'designcenter', 'layout', 'permit', 'permits', 'stakeout'],
  finished: ['finished', 'complete', 'completed', 'done', 'movein', 'moved'],
  construction: ['construction', 'wip', 'progress', 'rough'],
  brand: ['brand', 'branding', 'buildx', 'isuzu', 'justbuildbaby'],
  delivery: ['delivery', 'materialsdelivery', 'materials', 'lumber']
};

const WORD_TO_CONCEPTS = new Map<string, string[]>();
for (const [concept, words] of Object.entries(CONCEPTS)) {
  for (const w of [concept, ...words]) {
    const list = WORD_TO_CONCEPTS.get(w) ?? [];
    if (!list.includes(concept)) list.push(concept);
    WORD_TO_CONCEPTS.set(w, list);
  }
}

const NOISE = new Set([
  'mp4', 'mov', 'v2', 'img', 'dji', 'fly', 'video', 'cache', 'export', 'compose', 'full', 'broll', 'edits',
  'under', 'ht', 'x', 'a', 'the', 'and', 'of', 'to', 'closeup', 'wide', 'low', 'angle', 'lowangle', 'detail'
]);

export function conceptsFor(word: string): string[] {
  return WORD_TO_CONCEPTS.get(word) ?? [];
}

/** "ADU/WIP (Under Construction)/ADU_Interior_JobA_KitchenRough_01.mp4" -> lowercase name tokens. */
export function pathTokens(rel: string): string[] {
  const noExt = rel.replace(/\.[a-z0-9]+$/i, '');
  const parts = noExt.split(/[\\/]/);
  const out: string[] = [];
  for (const part of parts) {
    for (const chunk of part.split(/[_\s\-()#.]+/)) {
      if (!chunk) continue;
      // Keep the joined form ("KitchenRough") and its camel-case pieces.
      const pieces = chunk.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(' ');
      for (const t of new Set([chunk, ...pieces])) {
        const low = t.toLowerCase();
        if (low.length < 2 || NOISE.has(low)) continue;
        // Years, take numbers, job codes (X1251, A1103, 817, HT0620), dates.
        if (/^\d+$/.test(low) || /^[a-z]{1,2}\d{2,}$/.test(low) || /^\d{2,}[a-z]*$/.test(low)) continue;
        out.push(low);
      }
    }
  }
  return [...new Set(out)];
}

export function flagsFor(rel: string): string[] {
  const flags: string[] = [];
  if (/(^|\/)TIMELAPSE\//i.test(rel) || /timelapse|_TL_/i.test(rel)) flags.push('bedrock-watermark: crop or avoid for client work');
  if (/_logo(_|\.|$)/i.test(rel)) flags.push('third-party branding in frame');
  if (/HOMETOUR EDITS\//i.test(rel)) flags.push('finished edit, not raw b-roll');
  return flags;
}

export function orientationFromName(rel: string): 'horizontal' | 'vertical' | null {
  if (/vertical|9x16/i.test(rel)) return 'vertical';
  // Measured 2026-09: X1251_INTERIOR_01..44 are natively 1728x3072, _45 and up are horizontal.
  const m = /X1251_INTERIOR_(\d+)/i.exec(rel);
  if (m) return Number(m[1]) <= 44 ? 'vertical' : 'horizontal';
  return null;
}

export function tagsForPath(rel: string): string[] {
  const tokens = pathTokens(rel);
  const concepts = tokens.flatMap(conceptsFor);
  if (/WIP \(Under Construction\)/i.test(rel)) concepts.push('construction');
  return [...new Set([...tokens, ...concepts])];
}

export function buildClip(rel: string, previous?: BrollClip): BrollClip {
  const p = rel.split(path.sep).join('/');
  return {
    path: p,
    tags: tagsForPath(p),
    visualTags: previous?.visualTags ?? [],
    flags: flagsFor(p),
    orientation: previous?.orientation ?? orientationFromName(p)
  };
}

export function brollIndexPath(privateDir: string): string {
  return path.join(privateDir, 'broll', 'index.json');
}

export async function readBrollIndex(privateDir: string): Promise<BrollIndex> {
  const file = brollIndexPath(privateDir);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error(`No b-roll index at ${file} — build it with: node scripts/broll-tag.mjs "<MASTER BROLL FOLDER>"`);
    }
    throw error;
  }
}
