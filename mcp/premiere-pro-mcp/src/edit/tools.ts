/**
 * MCP tools for edit automation. Suggestions only — nothing here cuts the
 * timeline; approved lists go through scripts/plan-cut.mjs.
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createCutList, createPunchList, PunchListFile } from './files.js';
import { punchKeyframes } from './punchins.js';

/** Runs ExtendScript through the bridge (helpers like __findClip are prepended). */
export type RunScript = (script: string) => Promise<any>;

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
  },
  {
    name: 'suggest_punch_ins',
    description:
      'OPTIONAL — only run when the user asks for punch-ins; the first build has none. Suggests eased Scale pushes (default to 110% of the clip\'s own scale) on emphasis words (numbers, prices, stakes words) and sentence starts, at most one every minGapSeconds, from a WhisperX .words.json. Writes <name>.punchins.json + .md beside the transcript with every suggestion unapproved; never touches Premiere. A punch-in is a secondary layer, never a fake second camera angle. Apply chosen ids with apply_punch_ins.',
    inputSchema: z.object({
      transcriptPath: z.string().min(1).describe('Absolute path to the WhisperX <name>.words.json of the clip\'s source media.'),
      scalePercent: z.number().min(101).max(150).optional().describe('Punch size as % of the clip\'s own scale. Default 110.'),
      minGapSeconds: z.number().min(1).max(60).optional().describe('Seconds between punch-ins, at least. Default 4.'),
      easeSeconds: z.number().min(0.05).max(2).optional().describe('Length of each ease. Default 0.3.'),
      maxHoldSeconds: z.number().min(0.5).max(15).optional().describe('Longest hold before easing out. Default 3.'),
      write: z.boolean().optional().describe('Write the .punchins files. Default true.'),
      force: z.boolean().optional().describe('Replace an existing .punchins.json. Default false.')
    })
  },
  {
    name: 'apply_punch_ins',
    description:
      'Applies ONLY the punch-in ids the user chose from a .punchins.json to one timeline clip: four eased (bezier) Motion > Scale keyframes per punch-in, relative to the clip\'s current scale. Refuses a clip whose Scale already has keyframes. Times are source-media seconds (the transcript of the clip\'s source file); punch-ins outside the clip\'s in/out are skipped and reported. Reads the keyframes back to prove they landed. Undo with undo.',
    inputSchema: z.object({
      punchinsPath: z.string().min(1).describe('The <name>.punchins.json from suggest_punch_ins.'),
      clipId: z.string().min(1).describe('Timeline clip nodeId the transcript belongs to.'),
      ids: z.array(z.number().int().min(1)).min(1).describe('Punch-in ids the user approved.'),
      sequenceId: z.string().optional().describe('Sequence holding the clip. Default: search all.')
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

export async function executeEditTool(name: string, args: Record<string, any>, runScript?: RunScript): Promise<any> {
  if (name === 'suggest_punch_ins') return await suggestPunchInsTool(args);
  if (name === 'apply_punch_ins') {
    if (!runScript) return { success: false, error: 'apply_punch_ins needs the Premiere bridge.' };
    return await applyPunchInsTool(args, runScript);
  }
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

async function suggestPunchInsTool(args: Record<string, any>): Promise<any> {
  try {
    const result = await createPunchList(
      args.transcriptPath,
      {
        scalePercent: args.scalePercent,
        minGapSeconds: args.minGapSeconds,
        easeSeconds: args.easeSeconds,
        maxHoldSeconds: args.maxHoldSeconds
      },
      { write: args.write ?? true, force: args.force ?? false }
    );
    return {
      success: true,
      count: result.list.punchIns.length,
      scalePercent: result.list.scalePercent,
      punchIns: result.list.punchIns,
      punchinsJson: result.jsonPath,
      punchinsMd: result.mdPath,
      written: result.written,
      note: result.written
        ? `Nothing applied. Review ${result.mdPath}; apply chosen ids with apply_punch_ins.`
        : (args.write ?? true)
          ? `${result.jsonPath} already exists and was left alone. Pass force:true to replace it.`
          : 'Not written (write:false).'
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const FIND_SCALE = `
  var info = __findClip(CLIP_ID, SEQ_ID);
  if (!info) return JSON.stringify({ success: false, error: "Clip not found" });
  var clip = info.clip;
  var scale = null;
  for (var i = 0; i < clip.components.numItems && !scale; i++) {
    var comp = clip.components[i];
    if (comp.displayName !== "Motion") continue;
    for (var j = 0; j < comp.properties.numItems; j++) {
      if (comp.properties[j].displayName === "Scale") { scale = comp.properties[j]; break; }
    }
  }
  if (!scale) return JSON.stringify({ success: false, error: "Motion > Scale not found on clip" });
`;

function bind(script: string, clipId: string, sequenceId?: string): string {
  return script.replace('CLIP_ID', JSON.stringify(clipId)).replace('SEQ_ID', sequenceId ? JSON.stringify(sequenceId) : 'null');
}

function parse(result: any): any {
  return typeof result === 'string' ? JSON.parse(result) : result;
}

async function applyPunchInsTool(args: Record<string, any>, runScript: RunScript): Promise<any> {
  let list: PunchListFile;
  try {
    list = JSON.parse(await readFile(args.punchinsPath, 'utf8'));
  } catch (error) {
    return { success: false, error: `Could not read ${args.punchinsPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const ids: number[] = args.ids;
  const missing = ids.filter((id) => !list.punchIns.some((p) => p.id === id));
  if (missing.length) return { success: false, error: `No punch-in id ${missing.join(', ')} in ${args.punchinsPath}` };

  const probe = parse(
    await runScript(
      bind(
        `try {${FIND_SCALE}
        return JSON.stringify({ success: true, base: scale.getValue(), timeVarying: scale.isTimeVarying(),
          inPoint: clip.inPoint.seconds, outPoint: clip.outPoint.seconds, start: clip.start.seconds, name: clip.name });
      } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }`,
        args.clipId,
        args.sequenceId
      )
    )
  );
  if (!probe?.success) return { success: false, error: probe?.error ?? 'Could not read the clip' };
  if (probe.timeVarying) {
    return { success: false, error: 'This clip\'s Scale already has keyframes — refusing to mix punch-ins into them.' };
  }
  const base = Number(probe.base);

  const chosen = list.punchIns.filter((p) => ids.includes(p.id));
  const inside = chosen.filter((p) => p.rampInStart >= probe.inPoint && p.rampOutEnd <= probe.outPoint);
  const skipped = chosen.filter((p) => !inside.includes(p)).map((p) => ({ id: p.id, reason: `outside the clip (source ${probe.inPoint.toFixed(2)}–${probe.outPoint.toFixed(2)}s)` }));
  if (inside.length === 0) return { success: false, error: 'None of the chosen punch-ins fall inside this clip.', skipped };

  const keys = inside.flatMap((p) => punchKeyframes(p, base, list.scalePercent));
  const first = inside[0]!;
  // A quarter of the way up the first ease: ~2.5% of the way in if linear, less if eased.
  const probeTime = first.rampInStart + (first.inAt - first.rampInStart) * 0.25;
  const applied = parse(
    await runScript(
      bind(
        `try {${FIND_SCALE}
        var keys = ${JSON.stringify(keys)};
        scale.setTimeVarying(true);
        for (var k = 0; k < keys.length; k++) {
          scale.addKey(keys[k].time);
          scale.setValueAtKey(keys[k].time, keys[k].value, true);
        }
        // Linear -> bezier keeps linear tangents (no ease). Hold first flattens them,
        // so bezier then eases. Verified live: 25% into a 100->110 ramp reads 101.1, not 102.5.
        for (var k = 0; k < keys.length; k++) scale.setInterpolationTypeAtKey(keys[k].time, 4, true);
        for (var k = 0; k < keys.length; k++) scale.setInterpolationTypeAtKey(keys[k].time, 5, true);
        var back = [];
        var got = scale.getKeys();
        for (var g = 0; got && g < got.length; g++) {
          var t = got[g].seconds !== undefined ? got[g].seconds : got[g];
          back.push({ time: t, value: scale.getValueAtKey(got[g]) });
        }
        return JSON.stringify({ success: true, keys: back, sample: scale.getValueAtTime(${probeTime}) });
      } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }`,
        args.clipId,
        args.sequenceId
      )
    )
  );
  if (!applied?.success) return { success: false, error: applied?.error ?? 'Applying keyframes failed' };

  const linearSample = base + (base * (list.scalePercent / 100) - base) * 0.25;
  return {
    success: true,
    clip: probe.name,
    baseScale: base,
    punchedScale: Math.round(base * list.scalePercent * 10) / 1000,
    applied: inside.map((p) => p.id),
    skipped,
    keyframesExpected: keys.length,
    keyframesReadBack: applied.keys,
    easeCheck: {
      at: Math.round(probeTime * 1000) / 1000,
      value: applied.sample,
      linearWouldBe: Math.round(linearSample * 1000) / 1000,
      eased: typeof applied.sample === 'number' ? applied.sample < linearSample - 1e-3 : null
    }
  };
}
