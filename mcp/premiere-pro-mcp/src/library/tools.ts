/**
 * MCP tools over the BuildX video library. Pure file reads — nothing here talks
 * to Premiere or writes to the library.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { resolvePrivateDir } from './index.js';
import { findSimilarVideos } from './search.js';
import { readTranscriptText } from './transcript.js';

// dist/library/tools.js -> premiere-pro-mcp -> mcp -> repo root.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

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
  if (name !== 'find_similar_videos') {
    return { success: false, error: `Unknown library tool '${name}'` };
  }
  const privateDir = resolvePrivateDir(process.env, path.join(REPO_ROOT, 'private'));
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
