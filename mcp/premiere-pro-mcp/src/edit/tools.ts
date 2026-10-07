/**
 * MCP tools for edit automation. Suggestions only — nothing here cuts the
 * timeline; approved lists go through scripts/plan-cut.mjs.
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createBrollList, createCutList, createPunchList, createShortList, PunchListFile, ShortListFile } from './files.js';
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
  },
  {
    name: 'suggest_broll',
    description:
      'OPTIONAL — only run when the user asks for b-roll suggestions. Matches what is said in a WhisperX .words.json against the private b-roll tag index ($BUILDX_PRIVATE_DIR/broll/index.json, built by scripts/broll-tag.mjs) and suggests the top clips per phrase. Never covers the hook, keeps cutaways minGapSeconds apart, leaves out Bedrock-watermark and third-party-logo clips unless includeFlagged, and leaves out vertical clips for 16x9. Writes <name>.broll.json + .md with every suggestion unapproved; places nothing. Per broll.md, decide first whether to cut away at all — when the delivery is the content, stay on the speaker.',
    inputSchema: z.object({
      transcriptPath: z.string().min(1).describe('Absolute path to the WhisperX <name>.words.json.'),
      format: z.enum(['9x16', '16x9']).optional().describe('Target sequence shape.'),
      minGapSeconds: z.number().min(1).max(120).optional().describe('Seconds between cutaways, at least. Default 5.'),
      hookSeconds: z.number().min(0).optional().describe('No coverage before this. Default: end of the first sentence.'),
      clipsPerSuggestion: z.number().int().min(1).max(10).optional().describe('Candidate clips per phrase. Default 3.'),
      includeFlagged: z.boolean().optional().describe('Include watermark / third-party-logo clips. Default false.'),
      prefer: z.string().optional().describe('Prefer this job\'s own footage — a job number or name in the clip path, e.g. "817" or "X1252".'),
      write: z.boolean().optional().describe('Write the .broll files. Default true.'),
      force: z.boolean().optional().describe('Replace an existing .broll.json. Default false.')
    })
  },
  {
    name: 'find_short_candidates',
    description:
      'Podcast-to-shorts, step 1: from a long episode\'s WhisperX .words.json, finds 30-60s native windows that start and end on whole sentences and ranks them on the opening line (number, contradiction, stakes, question; weak openers like "so"/"and" and "BuildX" in the hook score down — editorial.md, SHORTS_ENGINE_SPEC.md). Checks each hook against past library hooks. Writes <name>.shorts.json + .md beside the transcript, all unapproved; builds nothing. The transcript must be of the master sequence for build_short_sequences to line up.',
    inputSchema: z.object({
      transcriptPath: z.string().min(1).describe('Absolute path to the episode\'s WhisperX <name>.words.json (of the master sequence).'),
      minSeconds: z.number().min(5).max(170).optional().describe('Shortest candidate. Default 30.'),
      maxSeconds: z.number().min(10).max(180).optional().describe('Longest candidate. Default 60.'),
      limit: z.number().int().min(1).max(60).optional().describe('Candidates to keep. Default 20.'),
      write: z.boolean().optional().describe('Write the .shorts files. Default true.'),
      force: z.boolean().optional().describe('Replace an existing .shorts.json. Default false.')
    })
  },
  {
    name: 'build_short_sequences',
    description:
      'Podcast-to-shorts, step 2: builds a 1080x1920 29.97 sequence for each APPROVED candidate id from a .shorts.json by copying that range out of the master sequence (createSubsequence — the master is never edited). Scales footage to fill the vertical frame, puts the BuildX logo (a video logo item, e.g. "BuildX Logo.mov") on V3 at 0.79444/0.16042 scale 31 over the content, and appends the 9:16 CTA end card after it. Does not export, caption, add the first-frame thumbnail card, or reframe per speaker — Thomas proof-watches first.',
    inputSchema: z.object({
      shortsPath: z.string().min(1).describe('The <name>.shorts.json from find_short_candidates.'),
      masterSequenceId: z.string().min(1).describe('The episode master sequence the transcript was made from.'),
      ids: z.array(z.number().int().min(1)).min(1).max(40).describe('Candidate ids the user approved.'),
      prefix: z.string().optional().describe('Name prefix, e.g. "EP12". Sequence names are "<prefix> <title>".'),
      titles: z.record(z.string()).optional().describe('Title overrides by id, e.g. {"3": "Septic Decides Everything"}.'),
      logo: z.boolean().optional().describe('Place the logo. Default true.'),
      endCard: z.boolean().optional().describe('Append the end card. Default true.')
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

export interface EditContext {
  /** $BUILDX_PRIVATE_DIR (or <repo>/private) — where the b-roll index lives. */
  privateDir?: string;
}

export async function executeEditTool(
  name: string,
  args: Record<string, any>,
  runScript?: RunScript,
  context: EditContext = {}
): Promise<any> {
  if (name === 'suggest_punch_ins') return await suggestPunchInsTool(args);
  if (name === 'suggest_broll') return await suggestBrollTool(args, context);
  if (name === 'find_short_candidates') return await findShortCandidatesTool(args, context);
  if (name === 'build_short_sequences') {
    if (!runScript) return { success: false, error: 'build_short_sequences needs the Premiere bridge.' };
    return await buildShortSequencesTool(args, runScript);
  }
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

async function suggestBrollTool(args: Record<string, any>, context: EditContext): Promise<any> {
  if (!context.privateDir) return { success: false, error: 'BuildX private dir is not configured — set BUILDX_PRIVATE_DIR on the MCP server.' };
  try {
    const result = await createBrollList(
      args.transcriptPath,
      context.privateDir,
      {
        format: args.format,
        minGapSeconds: args.minGapSeconds,
        hookSeconds: args.hookSeconds,
        clipsPerSuggestion: args.clipsPerSuggestion,
        includeFlagged: args.includeFlagged,
        prefer: args.prefer
      },
      { write: args.write ?? true, force: args.force ?? false }
    );
    return {
      success: true,
      libraryClips: result.libraryClips,
      libraryRoot: result.list.libraryRoot,
      count: result.list.suggestions.length,
      suggestions: result.list.suggestions,
      brollJson: result.jsonPath,
      brollMd: result.mdPath,
      written: result.written,
      note: result.written
        ? `Nothing placed. Review ${result.mdPath}.`
        : (args.write ?? true)
          ? `${result.jsonPath} already exists and was left alone. Pass force:true to replace it.`
          : 'Not written (write:false).'
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function findShortCandidatesTool(args: Record<string, any>, context: EditContext): Promise<any> {
  try {
    const result = await createShortList(
      args.transcriptPath,
      { minSeconds: args.minSeconds, maxSeconds: args.maxSeconds, limit: args.limit },
      { write: args.write ?? true, force: args.force ?? false, privateDir: context.privateDir }
    );
    return {
      success: true,
      count: result.list.candidates.length,
      hooksCheckedAgainst: result.hooksCheckedAgainst,
      candidates: result.list.candidates.map(({ text, ...c }) => c),
      shortsJson: result.jsonPath,
      shortsMd: result.mdPath,
      written: result.written,
      note: result.written
        ? `Nothing built. Review ${result.mdPath}; build chosen ids with build_short_sequences.`
        : (args.write ?? true)
          ? `${result.jsonPath} already exists and was left alone. Pass force:true to replace it.`
          : 'Not written (write:false).'
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 29.97 as a frame duration in ticks (1001/30000 s). */
const TICKS_2997 = '8475667200';
const LOGO_POSITION = [0.79444444, 0.16041667];
const LOGO_SCALE = 31;
const END_CARD_NAME = /buildx-cta-adu-journey-9x16-ig-v3/i;

const MOTION_HELPERS = `
  function __motionParam(clip, name) {
    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      if (comp.displayName !== "Motion") continue;
      for (var j = 0; j < comp.properties.numItems; j++) if (comp.properties[j].displayName === name) return comp.properties[j];
    }
    return null;
  }
`;

async function buildShortSequencesTool(args: Record<string, any>, runScript: RunScript): Promise<any> {
  let list: ShortListFile;
  try {
    list = JSON.parse(await readFile(args.shortsPath, 'utf8'));
  } catch (error) {
    return { success: false, error: `Could not read ${args.shortsPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const ids: number[] = args.ids;
  const missing = ids.filter((id) => !list.candidates.some((c) => c.id === id));
  if (missing.length) return { success: false, error: `No candidate id ${missing.join(', ')} in ${args.shortsPath}` };

  const probe = parse(
    await runScript(`try {
      var seq = __findSequence(${JSON.stringify(args.masterSequenceId)});
      if (!seq) return JSON.stringify({ success: false, error: "Master sequence not found" });
      var st = seq.getSettings();
      var logos = [], cards = [];
      function walk(item) {
        if ((item.type === 2 || item.type === 3) && item.children) { for (var i = 0; i < item.children.numItems; i++) walk(item.children[i]); return; }
        var p = ""; try { p = item.getMediaPath(); } catch (e) {}
        if (/buildx logo/i.test(item.name)) logos.push({ id: item.nodeId, name: item.name, path: p });
        if (/cta/i.test(item.name) && /9x16|end ?card/i.test(item.name) && /\\.(mov|mp4)$/i.test(p)) cards.push({ id: item.nodeId, name: item.name, path: p });
      }
      walk(app.project.rootItem);
      return JSON.stringify({ success: true, name: seq.name, seconds: __ticksToSeconds(seq.end), width: st.videoFrameWidth,
        height: st.videoFrameHeight, videoTracks: seq.videoTracks.numTracks, logos: logos, cards: cards });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }`)
  );
  if (!probe?.success) return { success: false, error: probe?.error ?? 'Could not read the master sequence' };

  // The transcript has to be of this master, or every range lands on the wrong words.
  if (list.transcriptSeconds > probe.seconds + 0.5) {
    return {
      success: false,
      error: `The transcript runs ${list.transcriptSeconds.toFixed(1)}s but "${probe.name}" is ${probe.seconds.toFixed(1)}s — it is not this sequence's transcript.`
    };
  }

  const warnings: string[] = [];
  const wantLogo = args.logo ?? true;
  const wantCard = args.endCard ?? true;
  // Stills hang ExtendScript when lengthened (clip.end), so only a video logo is placed.
  const logo = probe.logos.find((l: any) => /\.(mov|mp4)$/i.test(l.path));
  if (wantLogo && !logo) {
    warnings.push(
      probe.logos.length
        ? 'Only a still logo is in the project — stretching a still hangs Premiere, so no logo was placed. Import a logo .mov (e.g. sandbox "BuildX Logo.mov") and rebuild, or add it by hand.'
        : 'No "BuildX Logo" item in the project — no logo placed.'
    );
  }
  const card = probe.cards.find((c: any) => END_CARD_NAME.test(c.name)) ?? probe.cards[0];
  if (wantCard && !card) warnings.push('No 9x16 CTA end card in the project — import buildx-cta-adu-journey-9x16-ig-v3.mov and rebuild.');
  if (wantCard && card && !END_CARD_NAME.test(card.name)) warnings.push(`Used "${card.name}" — the standard card is buildx-cta-adu-journey-9x16-ig-v3.mov.`);
  if (wantLogo && logo && probe.videoTracks < 3) warnings.push('The master has fewer than 3 video tracks, so the logo cannot go on V3 — add it by hand.');

  const built: any[] = [];
  for (const id of ids) {
    const c = list.candidates.find((x) => x.id === id)!;
    if (c.end > probe.seconds + 0.05) {
      built.push({ id, success: false, error: `Ends at ${c.end}s, past the master's ${probe.seconds.toFixed(2)}s` });
      continue;
    }
    const title = args.titles?.[String(id)] ?? c.title;
    const name = [args.prefix, title].filter(Boolean).join(' ');
    const result = parse(
      await runScript(`try {
        ${MOTION_HELPERS}
        var master = __findSequence(${JSON.stringify(args.masterSequenceId)});
        var oldIn = master.getInPointAsTime().seconds, oldOut = master.getOutPointAsTime().seconds;
        master.setInPoint(${c.start});
        master.setOutPoint(${c.end});
        var sub = master.createSubsequence(true);
        master.setInPoint(oldIn);
        master.setOutPoint(oldOut);
        if (!sub) return JSON.stringify({ success: false, error: "createSubsequence returned nothing" });
        sub.name = ${JSON.stringify(name)};

        var st = sub.getSettings();
        st.videoFrameWidth = 1080;
        st.videoFrameHeight = 1920;
        var fr = new Time(); fr.ticks = "${TICKS_2997}";
        st.videoFrameRate = fr;
        sub.setSettings(st);

        // A clip that filled the master's height fills 1920 at scale * 1920 / masterHeight.
        var factor = 1920 / ${probe.height}, scaled = 0, skipped = 0;
        for (var t = 0; t < sub.videoTracks.numTracks; t++) {
          var tr = sub.videoTracks[t];
          for (var k = 0; k < tr.clips.numItems; k++) {
            var sc = __motionParam(tr.clips[k], "Scale");
            if (!sc) continue;
            if (sc.isTimeVarying()) { skipped++; continue; }
            sc.setValue(sc.getValue() * factor, true);
            scaled++;
          }
        }
        var contentEnd = __ticksToSeconds(sub.end);

        var logo = null;
        ${wantLogo && logo && probe.videoTracks >= 3 ? `
        var li = __findProjectItem(${JSON.stringify(logo.id)});
        if (li) {
          li.setInPoint(0, 4);
          li.setOutPoint(contentEnd, 4);
          sub.videoTracks[2].overwriteClip(li, 0);
          li.clearInPoint(); li.clearOutPoint();
          var lt = sub.videoTracks[2];
          for (var q = 0; q < lt.clips.numItems; q++) if (lt.clips[q].projectItem && lt.clips[q].projectItem.nodeId === li.nodeId) logo = lt.clips[q];
          if (logo) {
            __motionParam(logo, "Position").setValue(${JSON.stringify(LOGO_POSITION)}, true);
            __motionParam(logo, "Scale").setValue(${LOGO_SCALE}, true);
          }
        }` : ''}

        var card = null;
        ${wantCard && card ? `
        var ci = __findProjectItem(${JSON.stringify(card.id)});
        if (ci) {
          ci.clearInPoint(); ci.clearOutPoint();
          sub.videoTracks[0].overwriteClip(ci, contentEnd);
          var ct = sub.videoTracks[0];
          for (var q = 0; q < ct.clips.numItems; q++) if (ct.clips[q].projectItem && ct.clips[q].projectItem.nodeId === ci.nodeId) card = ct.clips[q];
        }` : ''}

        // Nothing but the card from its first frame on: the range end rarely lands on a
        // 29.97 frame, so a sliver of copied footage, audio or the master's own logo can
        // run under it. Footage only (never a still — clip.end on a still hangs Premiere).
        var tailRemoved = 0, tailTrimmed = 0, tailLeft = [];
        if (card) {
          var cardStart = card.start.seconds;
          var groups = [sub.videoTracks, sub.audioTracks];
          for (var gi = 0; gi < 2; gi++) {
            for (var t2 = 0; t2 < groups[gi].numTracks; t2++) {
              var tk = groups[gi][t2];
              for (var k2 = tk.clips.numItems - 1; k2 >= 0; k2--) {
                var it = tk.clips[k2];
                if (it.nodeId === card.nodeId || (logo && it.nodeId === logo.nodeId)) continue;
                if (it.start.seconds >= cardStart - 0.0005) {
                  try { it.remove(false, false); tailRemoved++; } catch (er) { tailLeft.push(it.name + " " + er); }
                } else if (it.end.seconds > cardStart + 0.0005) {
                  try { var te = new Time(); te.seconds = cardStart; it.end = te; tailTrimmed++; } catch (et) { tailLeft.push(it.name + " " + et); }
                }
              }
            }
          }
        }

        var s2 = sub.getSettings();
        return JSON.stringify({ success: true, sequenceId: sub.sequenceID, name: sub.name,
          width: s2.videoFrameWidth, height: s2.videoFrameHeight, frameTicks: s2.videoFrameRate.ticks,
          contentSeconds: contentEnd, totalSeconds: __ticksToSeconds(sub.end), clipsScaled: scaled, keyframedScaleSkipped: skipped,
          logo: logo ? { start: logo.start.seconds, end: logo.end.seconds, position: __motionParam(logo, "Position").getValue(), scale: __motionParam(logo, "Scale").getValue() } : null,
          endCard: card ? { start: card.start.seconds, end: card.end.seconds } : null,
          tail: { removed: tailRemoved, trimmed: tailTrimmed, left: tailLeft } });
      } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }`)
    );
    built.push({ id, title, ...result });
  }

  const ok = built.filter((b) => b.success);
  for (const b of ok) {
    if (b.frameTicks !== TICKS_2997 || b.width !== 1080 || b.height !== 1920) warnings.push(`#${b.id}: settings read back ${b.width}x${b.height} @ ${b.frameTicks} ticks — check the sequence settings.`);
    if (b.tail?.left?.length) warnings.push(`#${b.id}: could not clear under the end card: ${b.tail.left.join('; ')}`);
    if (b.logo && Math.abs(b.logo.end - b.contentSeconds) > 0.05) warnings.push(`#${b.id}: logo covers ${b.logo.start.toFixed(2)}–${b.logo.end.toFixed(2)}s of ${b.contentSeconds.toFixed(2)}s — the logo media is shorter than the short.`);
  }
  return {
    success: ok.length === built.length,
    master: probe.name,
    built,
    warnings,
    next: 'Proof-watch in Premiere. Still to do per short: captions, the first-frame thumbnail card, per-speaker reframing. Nothing was exported.'
  };
}
