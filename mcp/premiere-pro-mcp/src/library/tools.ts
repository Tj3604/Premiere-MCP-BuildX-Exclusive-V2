/**
 * MCP tools over the BuildX video library. Pure file reads — nothing here talks
 * to Premiere or writes to the library.
 */

import path from 'node:path';
import { REPO_ROOT } from '../utils/package-root.js';
import { z } from 'zod';
import { listEntries, resolvePrivateDir } from './index.js';
import { buildHookBank, checkHook, DEFAULT_MIN_VIEWS, DEFAULT_SIMILARITY_THRESHOLD } from './hooks.js';
import { findSimilarVideos } from './search.js';
import { readTranscriptText } from './transcript.js';


/** $BUILDX_PRIVATE_DIR, or <repo>/private. */
export function privateDirFromEnv(): string {
  return resolvePrivateDir(process.env, path.join(REPO_ROOT, 'private'));
}

/** <repo>/knowledge. */
export function knowledgeDirFromRepo(): string {
  return path.join(REPO_ROOT, 'knowledge');
}

export interface LibraryTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<any>;
}

const findSimilarSchema = z
  .object({
    transcriptPath: z
      .string()
      .optional()
      .describe('Absolute path to the new transcript (WhisperX .words.json, .srt, .txt or sidecar .json).'),
    text: z.string().optional().describe('Pasted transcript text.'),
    topic: z.string().optional().describe('A topic in a few words, e.g. "septic and water table".'),
    limit: z.number().int().min(1).max(10).optional().describe('How many to return. Default 5.')
  })
  .refine((a) => [a.transcriptPath, a.text, a.topic].filter((v) => typeof v === 'string' && v.trim()).length === 1, {
    message: 'Pass exactly one of transcriptPath, text or topic.'
  });

export const LIBRARY_TOOLS: LibraryTool[] = [
  {
    name: 'find_similar_videos',
    description:
      'Before editing: returns the 3–5 most similar past BuildX videos for a new transcript or topic, from the private video library ($BUILDX_PRIVATE_DIR). Each result carries its hook line, length, cut count, graphics, caption style, performance numbers when recorded, and the shared terms that made it match. Open one with the buildx://library/entry/<slug> resource.',
    inputSchema: findSimilarSchema
  },
  {
    name: 'list_hooks',
    description:
      'Hook bank: every past hook line from the BuildX video library, ranked by retention (average percentage viewed), stayed-to-watch, or 30-day views. Rates on fewer views than minViews are listed separately as belowViewFloor, never ranked. Hooks with no numbers yet come back as unmeasured.',
    inputSchema: z.object({
      sortBy: z
        .enum(['retention', 'stayedToWatch', 'views30d'])
        .optional()
        .describe('Default retention (average percentage viewed).'),
      limit: z.number().int().min(1).max(200).optional().describe('Ranked rows to return. Default 25.'),
      minViews: z.number().int().min(0).optional().describe(`View floor for rate rankings. Default ${DEFAULT_MIN_VIEWS}.`)
    })
  },
  {
    name: 'check_hook',
    description:
      'Before using a new hook: compares it against every hook in the library (posted and queued) and warns if it is too close — by word/character similarity or by opening with the same four words. Returns the closest past hooks with their status and numbers.',
    inputSchema: z.object({
      hook: z.string().min(1).describe('The new hook line, exact words.'),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(`Similarity (0-1) that counts as too close. Default ${DEFAULT_SIMILARITY_THRESHOLD}.`),
      limit: z.number().int().min(1).max(20).optional().describe('Closest hooks to return. Default 5.')
    })
  }
];

const LIBRARY_TOOL_NAMES: ReadonlySet<string> = new Set(LIBRARY_TOOLS.map((tool) => tool.name));

export function isLibraryTool(name: string): boolean {
  return LIBRARY_TOOL_NAMES.has(name);
}

export function getLibraryTools(): LibraryTool[] {
  return LIBRARY_TOOLS;
}

export async function executeLibraryTool(name: string, args: Record<string, any>): Promise<any> {
  const privateDir = resolvePrivateDir(process.env, path.join(REPO_ROOT, 'private'));

  if (name === 'list_hooks') {
    const { entries } = await listEntries(privateDir);
    const bank = buildHookBank(entries, args.sortBy ?? 'retention', args.minViews ?? DEFAULT_MIN_VIEWS, args.limit ?? 25);
    return {
      success: true,
      librarySize: entries.length,
      ...bank,
      belowViewFloorCount: bank.belowViewFloor.length,
      unmeasuredCount: bank.unmeasured.length,
      // The unmeasured list is the whole library until numbers are imported — counts only.
      unmeasured: undefined,
      note:
        bank.ranked.length === 0
          ? 'No hook has numbers above the view floor yet — import YouTube Studio data with scripts/library-import-youtube.mjs.'
          : undefined
    };
  }

  if (name === 'check_hook') {
    const { entries } = await listEntries(privateDir);
    return {
      success: true,
      librarySize: entries.length,
      ...checkHook(args.hook, entries, args.threshold ?? DEFAULT_SIMILARITY_THRESHOLD, args.limit ?? 5)
    };
  }

  if (name !== 'find_similar_videos') {
    return { success: false, error: `Unknown library tool '${name}'` };
  }
  const limit: number = args.limit ?? 5;

  let query: string;
  const excludePaths: string[] = [];
  if (args.transcriptPath) {
    try {
      query = await readTranscriptText(args.transcriptPath);
    } catch (error) {
      return {
        success: false,
        error: `Could not read transcript ${args.transcriptPath}: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    excludePaths.push(args.transcriptPath);
  } else {
    query = String(args.text ?? args.topic);
  }

  const result = await findSimilarVideos(privateDir, query, limit, excludePaths);
  return {
    success: true,
    privateDir,
    ...result,
    note:
      result.librarySize === 0
        ? 'The library is empty — add entries with scripts/library-add.mjs or scripts/library-import-transcripts.mjs.'
        : result.results.length === 0
          ? 'No past video shares subject vocabulary with this query.'
          : undefined
  };
}
