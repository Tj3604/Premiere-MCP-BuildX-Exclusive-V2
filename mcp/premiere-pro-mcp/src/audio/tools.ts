/**
 * MCP tools: measure_loudness (reads only) and normalize_loudness (writes a new
 * file beside the export, never over it).
 */

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { wordsFrom } from '../edit/cleanup.js';
import { cutListBase } from '../edit/files.js';
import { dbToPremiereLevel, DUCK_DEFAULTS, DuckKey, duckingMarkdown, duckKeys, keysForClip, premiereLevelToDb, speechSpans } from './ducking.js';
import { DEFAULT_TARGET, LoudnormTarget, measureLoudness, normalizeLoudness, onTarget } from './loudness.js';

export type RunScript = (script: string) => Promise<any>;

const targetFields = {
  target: z.number().min(-40).max(-5).optional().describe('Integrated loudness in LUFS. Default -14 (YouTube/Shorts/Reels/TikTok); -16 for podcasts.'),
  truePeak: z.number().min(-9).max(0).optional().describe('True-peak ceiling in dBTP. Default -1.')
};

export const AUDIO_TOOLS = [
  {
    name: 'measure_loudness',
    description:
      'Measures exports with ffmpeg EBU R128 (loudnorm): integrated LUFS, true peak dBTP, loudness range, and whether each is on the target (default -14 LUFS / -1 dBTP, the social-platform standard). Reads only.',
    inputSchema: z.object({ files: z.array(z.string().min(1)).min(1).max(50).describe('Absolute paths of exports.'), ...targetFields })
  },
  {
    name: 'normalize_loudness',
    description:
      'Normalises one export to the target (default -14 LUFS, -1 dBTP): measures (EBU R128), applies a fixed gain plus a true-peak limiter only if the peaks need it, then re-measures and corrects (up to 3 passes). Video is stream-copied. Writes <name>-14LUFS.<ext> beside the original (never overwrites; PCM stays PCM, else AAC 320k) and reports before/after and how many dB the limiter took off the peaks. Skips files already within 0.5 LU unless force.',
    inputSchema: z.object({
      file: z.string().min(1).describe('Absolute path of the export.'),
      ...targetFields,
      force: z.boolean().optional().describe('Write a new file even if already on target.')
    })
  },
  {
    name: 'plan_ducking',
    description:
      'OPTIONAL, and not for shorts (BuildX shorts carry no music). From a WhisperX .words.json of the sequence\'s dialogue, plans music-bed ducking: bed at bedDb (default -18) in gaps, duckDb (default -30) while anyone talks, fading down attackSeconds before speech and back up over releaseSeconds after; gaps under mergeGapSeconds stay ducked so the bed does not pump. Writes <name>.ducking.json + .md for review; applies nothing.',
    inputSchema: z.object({
      transcriptPath: z.string().min(1).describe('WhisperX .words.json of the sequence dialogue (sequence time).'),
      bedDb: z.number().min(-60).max(0).optional(),
      duckDb: z.number().min(-80).max(0).optional(),
      attackSeconds: z.number().min(0).max(2).optional(),
      releaseSeconds: z.number().min(0).max(5).optional(),
      mergeGapSeconds: z.number().min(0).max(5).optional(),
      force: z.boolean().optional().describe('Replace an existing .ducking.json.')
    })
  },
  {
    name: 'apply_ducking',
    description:
      'Applies a .ducking.json to ONE music clip: Volume > Level keyframes in the clip\'s own media time, on Premiere\'s scripted level scale (0 dB = 0.17783). Refuses a clip whose Level already has keyframes. Reads the keys back. Undo with undo.',
    inputSchema: z.object({
      duckingPath: z.string().min(1).describe('The <name>.ducking.json from plan_ducking.'),
      clipId: z.string().min(1).describe('The music clip on an audio track (nodeId).'),
      sequenceId: z.string().optional()
    })
  }
];

const NAMES: ReadonlySet<string> = new Set(AUDIO_TOOLS.map((t) => t.name));
export const isAudioTool = (name: string) => NAMES.has(name);
export const getAudioTools = () => AUDIO_TOOLS;

function targetFrom(args: Record<string, any>): LoudnormTarget {
  return { ...DEFAULT_TARGET, ...(args.target !== undefined ? { lufs: args.target } : {}), ...(args.truePeak !== undefined ? { truePeak: args.truePeak } : {}) };
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

interface DuckingFile {
  description: string;
  transcriptPath: string;
  options: typeof DUCK_DEFAULTS;
  spans: number;
  keys: DuckKey[];
}

async function planDucking(args: Record<string, any>): Promise<any> {
  const options = { ...DUCK_DEFAULTS };
  for (const k of Object.keys(DUCK_DEFAULTS) as Array<keyof typeof DUCK_DEFAULTS>) if (typeof args[k] === 'number') options[k] = args[k];
  if (options.duckDb >= options.bedDb) return { success: false, error: `duckDb (${options.duckDb}) must be below bedDb (${options.bedDb}).` };
  const words = wordsFrom(JSON.parse(await readFile(args.transcriptPath, 'utf8')));
  const spans = speechSpans(words, options.mergeGapSeconds);
  const keys = duckKeys(spans, options);
  const base = cutListBase(args.transcriptPath);
  const jsonPath = `${base}.ducking.json`;
  const mdPath = `${base}.ducking.md`;
  const exists = existsSync(jsonPath);
  if (!exists || args.force) {
    const file: DuckingFile = { description: 'Music-bed ducking keyframes in sequence seconds. Apply with apply_ducking.', transcriptPath: args.transcriptPath, options, spans: spans.length, keys };
    await writeAtomic(jsonPath, JSON.stringify(file, null, 2) + '\n');
    await writeAtomic(mdPath, duckingMarkdown(path.basename(base), spans, keys, options));
  }
  return {
    success: true,
    spans: spans.length,
    keyframes: keys.length,
    options,
    duckingJson: jsonPath,
    duckingMd: mdPath,
    written: !exists || !!args.force,
    note: exists && !args.force ? `${jsonPath} already exists and was left alone. Pass force:true to replace it.` : `Nothing applied. Review ${mdPath}, then apply_ducking on the music clip.`
  };
}

const FIND_LEVEL = `
  var info = __findClip(CLIP_ID, SEQ_ID);
  if (!info) return JSON.stringify({ success: false, error: "Clip not found" });
  if (info.trackType !== "audio") return JSON.stringify({ success: false, error: "That clip is on a video track — pass the music clip on an audio track" });
  var clip = info.clip, level = null;
  for (var i = 0; i < clip.components.numItems && !level; i++) {
    var comp = clip.components[i];
    if (comp.displayName !== "Volume") continue;
    for (var j = 0; j < comp.properties.numItems; j++) if (comp.properties[j].displayName === "Level") { level = comp.properties[j]; break; }
  }
  if (!level) return JSON.stringify({ success: false, error: "Volume > Level not found on the clip" });
`;

async function applyDucking(args: Record<string, any>, runScript: RunScript): Promise<any> {
  const plan: DuckingFile = JSON.parse(await readFile(args.duckingPath, 'utf8'));
  const bind = (s: string) => s.replace('CLIP_ID', JSON.stringify(args.clipId)).replace('SEQ_ID', args.sequenceId ? JSON.stringify(args.sequenceId) : 'null');
  const parse = (r: any) => (typeof r === 'string' ? JSON.parse(r) : r);
  const probe = parse(await runScript(bind(`try {${FIND_LEVEL}
    return JSON.stringify({ success: true, name: clip.name, start: clip.start.seconds, end: clip.end.seconds, inPoint: clip.inPoint.seconds, keyed: level.isTimeVarying(), level: level.getValue() });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }`)));
  if (!probe?.success) return { success: false, error: probe?.error ?? 'Could not read the clip' };
  if (probe.keyed) return { success: false, error: `"${probe.name}" already has volume keyframes — refusing to mix ducking into them.` };

  const keys = keysForClip(plan.keys, probe, plan.options.bedDb).map((k) => ({ time: k.time, value: Number(dbToPremiereLevel(k.db).toFixed(6)), db: k.db }));
  const applied = parse(await runScript(bind(`try {${FIND_LEVEL}
    var keys = ${JSON.stringify(keys)};
    level.setTimeVarying(true);
    for (var k = 0; k < keys.length; k++) { level.addKey(keys[k].time); level.setValueAtKey(keys[k].time, keys[k].value, true); }
    var back = [], got = level.getKeys();
    for (var g = 0; got && g < got.length; g++) back.push({ time: got[g].seconds, value: level.getValueAtKey(got[g]) });
    return JSON.stringify({ success: true, keys: back });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }`)));
  if (!applied?.success) return { success: false, error: applied?.error ?? 'Applying keyframes failed' };
  const readBack = (applied.keys as Array<{ time: number; value: number }>).map((k) => ({ time: Math.round(k.time * 1000) / 1000, db: Math.round(premiereLevelToDb(k.value) * 10) / 10 }));
  return {
    success: true,
    clip: probe.name,
    levelBeforeDb: Math.round(premiereLevelToDb(probe.level) * 10) / 10,
    keyframesExpected: keys.length,
    keyframesReadBack: readBack.length,
    readBack: readBack.slice(0, 12),
    note: 'Keys are in the clip\'s media time. Prove the mix by rendering and measuring (the level scale is easy to get wrong).'
  };
}

export async function executeAudioTool(name: string, args: Record<string, any>, runScript?: RunScript): Promise<any> {
  const target = targetFrom(args);
  try {
    if (name === 'plan_ducking') return await planDucking(args);
    if (name === 'apply_ducking') {
      if (!runScript) return { success: false, error: 'apply_ducking needs the Premiere bridge.' };
      return await applyDucking(args, runScript);
    }
    if (name === 'measure_loudness') {
      const results = [];
      for (const file of args.files as string[]) {
        if (!existsSync(file)) { results.push({ file, error: 'not found' }); continue; }
        try {
          const m = await measureLoudness(file, target);
          results.push({ file, ...m, onTarget: onTarget(m, target), gainToTargetDb: Math.round((target.lufs - m.integratedLufs) * 10) / 10 });
        } catch (error) {
          results.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { success: true, target, results };
    }
    if (name === 'normalize_loudness') {
      if (!existsSync(args.file)) return { success: false, error: `No file at ${args.file}` };
      return { success: true, target, ...(await normalizeLoudness(args.file, target, { force: !!args.force })) };
    }
    return { success: false, error: `Unknown audio tool '${name}'` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
