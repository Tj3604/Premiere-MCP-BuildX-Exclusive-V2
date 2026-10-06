/**
 * Caption tools: make_captions writes <name>.srt + a review sheet from WhisperX
 * word timings; place_captions puts an SRT on a sequence as a caption track.
 * Track styling (Thomas Default) and the frame-0 trim stay in the GUI — there is
 * no caption-track scripting API.
 */

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { wordsFrom } from '../edit/cleanup.js';
import { cutListBase } from '../edit/files.js';
import { buildCues, captionsMarkdown, flagCues, overlaps, parseLexicon, toSrt } from './build.js';

export type RunScript = (script: string) => Promise<any>;

export interface CaptionContext {
  /** <repo>/knowledge — terminology.md's lexicon is read from here. */
  knowledgeDir?: string;
}

export const CAPTION_TOOLS = [
  {
    name: 'make_captions',
    description:
      'BuildX captions from a WhisperX .words.json: single-line cues fitted by measured width at Thomas Default (Poppins Bold 75, 745px ceiling), never overlapping, first cue at frame 1 (clear of the thumbnail card), stretched toward 1.2s where there is room. Changes no words — writes <name>.srt and a <name>.captions.md review sheet flagging low-confidence words, terminology.md mis-transcriptions, figures to check against verified-facts.md and "drywall". For a short cut from a longer master, pass rangeStart/rangeEnd (master seconds) and the cues are re-timed to start at 0.',
    inputSchema: z.object({
      transcriptPath: z.string().min(1).describe('Absolute path to the WhisperX <name>.words.json.'),
      rangeStart: z.number().min(0).optional().describe('Only words from here (source seconds); cues re-timed so this is 0.'),
      rangeEnd: z.number().positive().optional().describe('Only words up to here (source seconds).'),
      outputName: z.string().optional().describe('Base name for the .srt/.captions.md, written beside the transcript. Default: the transcript name, plus the range if given.'),
      maxWidthPx: z.number().min(200).max(1000).optional().describe('Line width ceiling. Default 745.'),
      minSeconds: z.number().min(0).max(5).optional().describe('Stretch cues toward this where room allows. Default 1.2.'),
      firstStartSeconds: z.number().min(0).optional().describe('Earliest first cue. Default frame 1 at 29.97.'),
      force: z.boolean().optional().describe('Replace an existing .srt. Default false.')
    })
  },
  {
    name: 'place_captions',
    description:
      'Puts an .srt on a sequence as a caption track (imports the SRT once — reuses an existing project item for the same file — then sequence.createCaptionTrack at 0). The track lands unstyled: then in the GUI, Properties → Track Style → Thomas Default (one click per sequence), and trim caption 1 off frame 0 if Premiere put it there (reference_caption_frame0_trim).',
    inputSchema: z.object({
      srtPath: z.string().min(1).describe('Absolute path to the .srt.'),
      sequenceId: z.string().min(1).describe('Sequence to caption.')
    })
  }
];

const NAMES: ReadonlySet<string> = new Set(CAPTION_TOOLS.map((t) => t.name));
export const isCaptionTool = (name: string) => NAMES.has(name);
export const getCaptionTools = () => CAPTION_TOOLS;

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

export async function executeCaptionTool(name: string, args: Record<string, any>, runScript?: RunScript, context: CaptionContext = {}): Promise<any> {
  try {
    if (name === 'make_captions') return await makeCaptions(args, context);
    if (name === 'place_captions') {
      if (!runScript) return { success: false, error: 'place_captions needs the Premiere bridge.' };
      return await placeCaptions(args, runScript);
    }
    return { success: false, error: `Unknown caption tool '${name}'` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function makeCaptions(args: Record<string, any>, context: CaptionContext): Promise<any> {
  let words = wordsFrom(JSON.parse(await readFile(args.transcriptPath, 'utf8')));
  const from: number | undefined = args.rangeStart;
  const to: number | undefined = args.rangeEnd;
  if (from !== undefined || to !== undefined) {
    const lo = from ?? 0;
    const hi = to ?? Infinity;
    words = words.filter((w) => w.start >= lo - 0.01 && w.end <= hi + 0.01).map((w) => ({ ...w, start: w.start - lo, end: w.end - lo }));
  }
  if (words.length === 0) return { success: false, error: 'No words in that range.' };

  const cues = buildCues(words, { maxWidthPx: args.maxWidthPx, minSeconds: args.minSeconds, firstStartSeconds: args.firstStartSeconds });
  const bad = overlaps(cues);
  if (bad.length) return { success: false, error: `Cue overlap after fitting (${bad.map((p) => p.join('/')).join(', ')}) — not written.` };

  const lexiconFile = context.knowledgeDir ? path.join(context.knowledgeDir, 'buildx', 'terminology.md') : null;
  const lexicon = lexiconFile && existsSync(lexiconFile) ? parseLexicon(await readFile(lexiconFile, 'utf8')) : { phrases: [] };
  const flags = flagCues(cues, words, lexicon);

  const dir = path.dirname(args.transcriptPath);
  const rangeTag = from !== undefined || to !== undefined ? `.${Math.round((from ?? 0) * 10) / 10}-${Math.round((to ?? words[words.length - 1]!.end) * 10) / 10}s` : '';
  const base = args.outputName ? path.join(dir, args.outputName) : `${cutListBase(args.transcriptPath)}${rangeTag}`;
  const srtPath = `${base}.srt`;
  const mdPath = `${base}.captions.md`;
  const exists = existsSync(srtPath);
  if (!exists || args.force) {
    await writeAtomic(srtPath, toSrt(cues));
    await writeAtomic(mdPath, captionsMarkdown(path.basename(base), cues, flags));
  }
  return {
    success: true,
    cues: cues.length,
    widestPx: cues.reduce((a, c) => Math.max(a, c.widthPx), 0),
    firstCue: cues[0],
    flags,
    lexiconPhrases: lexicon.phrases.length,
    srtPath,
    captionsMd: mdPath,
    written: !exists || !!args.force,
    note: exists && !args.force ? `${srtPath} already exists and was left alone. Pass force:true to replace it.` : `Review ${mdPath} before burning in, then place_captions.`
  };
}

async function placeCaptions(args: Record<string, any>, runScript: RunScript): Promise<any> {
  if (!existsSync(args.srtPath)) return { success: false, error: `No file at ${args.srtPath}` };
  const cueCount = (await readFile(args.srtPath, 'utf8')).split(/\r?\n\r?\n/).filter((b) => /-->/.test(b)).length;
  const raw = await runScript(`try {
    var seq = __findSequence(${JSON.stringify(args.sequenceId)});
    if (!seq) return JSON.stringify({ success: false, error: "Sequence not found" });
    var want = ${JSON.stringify(args.srtPath)};
    function find(item) {
      if ((item.type === 2 || item.type === 3) && item.children) {
        for (var i = 0; i < item.children.numItems; i++) { var f = find(item.children[i]); if (f) return f; }
        return null;
      }
      var p = ""; try { p = item.getMediaPath(); } catch (e) {}
      return __samePath(p, want) ? item : null;
    }
    var item = find(app.project.rootItem), imported = false;
    if (!item) {
      app.project.importFiles([want], true, app.project.rootItem, false);
      item = find(app.project.rootItem);
      imported = true;
    }
    if (!item) return JSON.stringify({ success: false, error: "SRT did not import" });
    seq.createCaptionTrack(item, 0);
    return JSON.stringify({ success: true, sequence: seq.name, srtItem: item.nodeId, imported: imported });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }`);
  const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!result?.success) return { success: false, error: result?.error ?? 'place_captions failed' };
  return {
    ...result,
    cuesInFile: cueCount,
    verify: `Caption tracks cannot be read by script. In Premiere, the Properties panel shows "N of M" on a selected caption — M must be ${cueCount}; fewer means cues merged.`,
    next: 'GUI: Properties → Track Style → Thomas Default; trim caption 1 off frame 0 if it starts there.'
  };
}
