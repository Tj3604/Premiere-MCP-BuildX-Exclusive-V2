/**
 * Find past videos similar to a new transcript or topic.
 *
 * TF-IDF cosine over each entry's full transcript plus its title and hook line.
 * No model, no network: the library is a few hundred short documents, and what
 * matters is shared subject vocabulary (septic, GFA, permit, garage) — exactly
 * what TF-IDF weighs up once filler and function words are dropped.
 */

import path from 'node:path';
import { listEntries, type VideoEntry } from './index.js';
import { readTranscriptText } from './transcript.js';

// Function words plus spoken filler. Domain words (adu, septic, permit…) are kept.
const STOPWORDS = new Set(
  `a about above after again against all also am an and any are aren't as at be because been before being below
  between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few
  for from further get gets getting got gonna gotta had hadn't has hasn't have haven't having he he'd he'll he's her
  here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself
  just let's me more most mustn't my myself no nor not now of off on once only or other ought our ours ourselves out
  over own same say says said she she'd she'll she's should shouldn't so some such than that that's the their theirs
  them themselves then there there's these they they'd they'll they're they've thing things think this those
  through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where
  where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your
  yours yourself yourselves um uh uhm erm hmm mm like yeah yes okay ok oh well right really actually basically
  literally kind sort lot lots know mean going want wanna see look come came make made go goes went way back even
  still one two also much many something anything everything someone anybody somebody people guy guys`.split(/\s+/)
);

export interface SimilarVideo {
  rank: number;
  score: number;
  slug: string;
  uri: string;
  title: string;
  hookLine: string;
  lengthSeconds: number;
  cutCount: number | null;
  graphicsUsed: string[];
  captionStyle: string | null;
  publishDate: string | null;
  views30d: number | null;
  stayedToWatchPercent: number | null;
  retentionPercent: number | null;
  sharedTerms: string[];
}

export interface SimilarSearchResult {
  librarySize: number;
  searched: number;
  results: SimilarVideo[];
  /** Entries whose transcript could not be read; they were matched on title + hook only. */
  transcriptProblems: string[];
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

type Vector = Map<string, number>;

function weigh(tf: Map<string, number>, idf: Map<string, number>, defaultIdf: number): Vector {
  const v: Vector = new Map();
  for (const [term, count] of tf) v.set(term, (1 + Math.log(count)) * (idf.get(term) ?? defaultIdf));
  return v;
}

function norm(v: Vector): number {
  let sum = 0;
  for (const w of v.values()) sum += w * w;
  return Math.sqrt(sum);
}

export interface SearchDocument {
  entry: VideoEntry;
  text: string;
}

/** Pure ranking over already-loaded documents. */
export function rankSimilar(query: string, docs: SearchDocument[], limit: number, excludePaths: string[] = []): SimilarVideo[] {
  const excluded = new Set(excludePaths.map((p) => path.resolve(p)));
  const pool = docs.filter(
    (d) => !excluded.has(path.resolve(d.entry.exportPath)) && !excluded.has(path.resolve(d.entry.transcriptPath))
  );
  if (pool.length === 0) return [];

  const docTf = pool.map((d) => termFrequencies(tokenize(`${d.entry.title} ${d.entry.hookLine} ${d.text}`)));
  const df = new Map<string, number>();
  for (const tf of docTf) for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const n = pool.length;
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
  const unseenIdf = Math.log(n + 1) + 1;

  const q = weigh(termFrequencies(tokenize(query)), idf, unseenIdf);
  const qNorm = norm(q);
  if (qNorm === 0) return [];

  const scored = pool.map((doc, i) => {
    const d = weigh(docTf[i]!, idf, unseenIdf);
    const contributions: Array<[string, number]> = [];
    let dot = 0;
    for (const [term, w] of q) {
      const dw = d.get(term);
      if (dw) {
        dot += w * dw;
        contributions.push([term, w * dw]);
      }
    }
    const dNorm = norm(d);
    const score = dNorm === 0 ? 0 : dot / (qNorm * dNorm);
    contributions.sort((a, b) => b[1] - a[1]);
    return { doc, score, sharedTerms: contributions.slice(0, 6).map(([t]) => t) };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s, i) => {
      const e = s.doc.entry;
      return {
        rank: i + 1,
        score: Number(s.score.toFixed(3)),
        slug: e.slug,
        uri: `buildx://library/entry/${e.slug}`,
        title: e.title,
        hookLine: e.hookLine,
        lengthSeconds: e.lengthSeconds,
        cutCount: e.cutCount,
        graphicsUsed: e.graphicsUsed,
        captionStyle: e.captionStyle,
        publishDate: e.publishDate,
        views30d: e.performance.views30d,
        stayedToWatchPercent: e.performance.stayedToWatchPercent,
        retentionPercent: e.performance.retentionPercent,
        sharedTerms: s.sharedTerms
      };
    });
}

/** Load the library (transcripts included) and rank it against a query. */
export async function findSimilarVideos(
  privateDir: string,
  query: string,
  limit: number,
  excludePaths: string[] = []
): Promise<SimilarSearchResult> {
  const { entries } = await listEntries(privateDir);
  const transcriptProblems: string[] = [];
  const docs: SearchDocument[] = [];
  for (const entry of entries) {
    let text = '';
    try {
      text = await readTranscriptText(entry.transcriptPath);
    } catch (error) {
      transcriptProblems.push(`${entry.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
    docs.push({ entry, text });
  }
  const results = rankSimilar(query, docs, limit, excludePaths);
  return { librarySize: entries.length, searched: docs.length, results, transcriptProblems };
}
