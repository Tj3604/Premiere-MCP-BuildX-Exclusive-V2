/**
 * export_platform_versions: YouTube Shorts / Reels / TikTok copies of one export.
 */

import { existsSync } from 'node:fs';
import { z } from 'zod';
import { coverPaths, pickCoverFrames } from './covers.js';
import { exportPlatformVersions } from './platforms.js';

export interface ExportContext {
  repoRoot?: string;
  privateDir?: string;
}

export const EXPORT_TOOLS = [
  {
    name: 'export_platform_versions',
    description:
      'From one finished 9:16 export, writes YouTube Shorts (~16 Mbps), Reels (~10 Mbps) and TikTok (~10 Mbps) versions: H.264 High / AAC 48k, source frame rate, -14 LUFS / -1 dBTP, under the 480 MB cap, named "<export> - <Platform>.mp4" in a "Platform Versions" folder beside the export. Refuses a non-9:16 file; warns on black bars and on platform length limits (Shorts/Reels 3 min, TikTok 10 min). Never overwrites. Reads each output back.',
    inputSchema: z.object({
      exportPath: z.string().min(1).describe('Absolute path of the finished export.'),
      platforms: z.array(z.enum(['youtube-shorts', 'reels', 'tiktok'])).optional().describe('Default all three.')
    })
  },
  {
    name: 'pick_cover_frames',
    description:
      'Thumbnail candidates: scores a frame every 0.5s of an export (a clear, centred, well-sized face via YuNet; sharpness; contrast; brightness), skipping the first-frame thumbnail card and the 8s end card, and saves the best few (default 5, at least 2s apart) as full-resolution JPGs plus a numbered contact sheet in a "Cover Candidates" folder beside the export, for Thomas to choose. Needs OpenCV Python (BUILDX_CV_PYTHON, default the PySceneDetect uv tool) and the YuNet model (BUILDX_FACE_MODEL, default $BUILDX_PRIVATE_DIR/models/yunet.onnx). Reads the video only.',
    inputSchema: z.object({
      exportPath: z.string().min(1).describe('Absolute path of the export.'),
      count: z.number().int().min(1).max(12).optional().describe('How many candidates. Default 5.'),
      minGapSeconds: z.number().min(0).max(30).optional().describe('Seconds between candidates, at least. Default 2.')
    })
  }
];

const NAMES: ReadonlySet<string> = new Set(EXPORT_TOOLS.map((t) => t.name));
export const isExportTool = (name: string) => NAMES.has(name);
export const getExportTools = () => EXPORT_TOOLS;

export async function executeExportTool(name: string, args: Record<string, any>, context: ExportContext = {}): Promise<any> {
  if (name === 'pick_cover_frames') {
    if (!existsSync(args.exportPath)) return { success: false, error: `No file at ${args.exportPath}` };
    if (!context.repoRoot || !context.privateDir) return { success: false, error: 'Repo and private dirs are not configured on the MCP server.' };
    try {
      return { success: true, ...(await pickCoverFrames(args.exportPath, coverPaths(context.repoRoot, context.privateDir), { count: args.count, minGapSeconds: args.minGapSeconds })) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (name !== 'export_platform_versions') return { success: false, error: `Unknown export tool '${name}'` };
  if (!existsSync(args.exportPath)) return { success: false, error: `No file at ${args.exportPath}` };
  try {
    const r = await exportPlatformVersions(args.exportPath, args.platforms);
    return { success: r.results.every((x) => x.problems.length === 0), ...r };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
