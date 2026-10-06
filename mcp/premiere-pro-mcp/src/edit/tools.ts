/**
 * MCP tools for edit automation. Suggestions only — nothing here cuts the
 * timeline; approved lists go through scripts/plan-cut.mjs.
 */

import { z } from 'zod';
import { createCutList } from './files.js';

export interface EditTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<any>;
}

export const EDIT_TOOLS: EditTool[] = [
  {
    name: 'find_cuts',
    description:
      'OPTIONAL tightening pass — only run when the user asks for silence/filler removal. The first build always uses the full take; never apply these cuts by default. Lists pauses longer than minPauseSeconds and fillers (um/uh recommended cut; "like"/"you know" review, since they are often real words) from a WhisperX .words.json. Writes <name>.cuts.json + <name>.cuts.md beside the transcript with every suggestion unapproved, and never touches Premiere. The user picks cuts with `node scripts/find-cuts.mjs --apply <name>.cuts.json --approve <ids|cuts>`, which writes plan-cut keep-ranges.',
    inputSchema: z.object({
      transcriptPath: z.string().min(1).describe('Absolute path to the WhisperX <name>.words.json.'),
      minPauseSeconds: z.number().min(0.1).max(10).optional().describe('Pauses longer than this are cut. Default 0.6.'),
      keepPauseSeconds: z.number().min(0).max(2).optional().describe('Silence left where a cut is made. Default 0.15.'),
      durationSeconds: z.number().positive().optional().describe('Media length, so trailing silence can be cut. Default: end of the last word.'),
      write: z.boolean().optional().describe('Write the .cuts.json/.cuts.md files. Default true.'),
      force: z.boolean().optional().describe('Replace an existing .cuts.json (loses edited approvals). Default false.')
    })
  }
];

const EDIT_TOOL_NAMES: ReadonlySet<string> = new Set(EDIT_TOOLS.map((tool) => tool.name));

export function isEditTool(name: string): boolean {
  return EDIT_TOOL_NAMES.has(name);
}

export function getEditTools(): EditTool[] {
  return EDIT_TOOLS;
}

export async function executeEditTool(name: string, args: Record<string, any>): Promise<any> {
  if (name !== 'find_cuts') return { success: false, error: `Unknown edit tool '${name}'` };
  try {
    const result = await createCutList(
      args.transcriptPath,
      { minPauseSeconds: args.minPauseSeconds, keepPauseSeconds: args.keepPauseSeconds, durationSeconds: args.durationSeconds },
      { write: args.write ?? true, force: args.force ?? false }
    );
    return {
      success: true,
      summary: result.list.summary,
      cuts: result.list.cuts,
      cutsJson: result.cutsJson,
      cutsMd: result.cutsMd,
      written: result.written,
      note: result.written
        ? `Review ${result.cutsMd}, then: node scripts/find-cuts.mjs --apply "${result.cutsJson}"`
        : (args.write ?? true)
          ? `${result.cutsJson} already exists and was left alone (it may hold edited approvals). Pass force:true to replace it.`
          : 'Not written (write:false).'
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
