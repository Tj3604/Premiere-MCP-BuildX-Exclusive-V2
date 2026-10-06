/**
 * MCP tools: measure_loudness (reads only) and normalize_loudness (writes a new
 * file beside the export, never over it).
 */

import { existsSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_TARGET, LoudnormTarget, measureLoudness, normalizeLoudness, onTarget } from './loudness.js';

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
  }
];

const NAMES: ReadonlySet<string> = new Set(AUDIO_TOOLS.map((t) => t.name));
export const isAudioTool = (name: string) => NAMES.has(name);
export const getAudioTools = () => AUDIO_TOOLS;

function targetFrom(args: Record<string, any>): LoudnormTarget {
  return { ...DEFAULT_TARGET, ...(args.target !== undefined ? { lufs: args.target } : {}), ...(args.truePeak !== undefined ? { truePeak: args.truePeak } : {}) };
}

export async function executeAudioTool(name: string, args: Record<string, any>): Promise<any> {
  const target = targetFrom(args);
  try {
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
