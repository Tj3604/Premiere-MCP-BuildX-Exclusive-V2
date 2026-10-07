/**
 * export_platform_versions: YouTube Shorts / Reels / TikTok copies of one export.
 */

import { existsSync } from 'node:fs';
import { z } from 'zod';
import { exportPlatformVersions } from './platforms.js';

export const EXPORT_TOOLS = [
  {
    name: 'export_platform_versions',
    description:
      'From one finished 9:16 export, writes YouTube Shorts (~16 Mbps), Reels (~10 Mbps) and TikTok (~10 Mbps) versions: H.264 High / AAC 48k, source frame rate, -14 LUFS / -1 dBTP, under the 480 MB cap, named "<export> - <Platform>.mp4" in a "Platform Versions" folder beside the export. Refuses a non-9:16 file; warns on black bars and on platform length limits (Shorts/Reels 3 min, TikTok 10 min). Never overwrites. Reads each output back.',
    inputSchema: z.object({
      exportPath: z.string().min(1).describe('Absolute path of the finished export.'),
      platforms: z.array(z.enum(['youtube-shorts', 'reels', 'tiktok'])).optional().describe('Default all three.')
    })
  }
];

const NAMES: ReadonlySet<string> = new Set(EXPORT_TOOLS.map((t) => t.name));
export const isExportTool = (name: string) => NAMES.has(name);
export const getExportTools = () => EXPORT_TOOLS;

export async function executeExportTool(name: string, args: Record<string, any>): Promise<any> {
  if (name !== 'export_platform_versions') return { success: false, error: `Unknown export tool '${name}'` };
  if (!existsSync(args.exportPath)) return { success: false, error: `No file at ${args.exportPath}` };
  try {
    const r = await exportPlatformVersions(args.exportPath, args.platforms);
    return { success: r.results.every((x) => x.problems.length === 0), ...r };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
