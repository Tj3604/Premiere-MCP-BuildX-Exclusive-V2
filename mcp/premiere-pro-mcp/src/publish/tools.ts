/**
 * upload_metadata_brief: everything the agent needs to write titles, descriptions
 * and hashtags. save_upload_metadata: checks them and writes the sidecars.
 */

import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { findSimilarVideos } from '../library/search.js';
import { firstSentence, readTranscriptText } from '../library/transcript.js';
import { checkMetadata, composed, figures, HASHTAGS, LIMITS, metadataMarkdown, type UploadMetadata } from './metadata.js';

export interface PublishContext {
  privateDir?: string;
}

const platformText = z.object({
  title: z.string().optional(),
  text: z.string().describe('YouTube description, or the Instagram / TikTok caption — without the hashtags.'),
  hashtags: z.array(z.string()).describe('3–5, each starting with #.')
});

export const PUBLISH_TOOLS = [
  {
    name: 'upload_metadata_brief',
    description:
      'Step 1 of upload metadata: returns the transcript, its hook line, every figure said, the closest past BuildX videos (titles, hooks, numbers) and the rules — platform limits (YouTube title 100, captions 2200, 3–5 hashtags, #shorts on YouTube), no "drywall", no figure that was not said, NO call to action (BuildX never authors one), and the measured hook findings (lead with a number or stakes; never open with "BuildX"; no "Meet The <Model>"). Write the YouTube title + description, Instagram caption and TikTok caption from it, using exact facts from the transcript, then call save_upload_metadata.',
    inputSchema: z.object({
      transcriptPath: z.string().min(1).describe('Transcript of the export (.words.json, .srt, .txt).')
    })
  },
  {
    name: 'save_upload_metadata',
    description:
      'Step 2: checks the written metadata against the rules and, only if every check passes, writes "<export> - Upload.json" (for an automated poster) and "<export> - Upload.md" (copy-paste) into the "Platform Versions" folder beside the export — never into Exports/ itself. Returns the errors to fix otherwise. Never overwrites unless force.',
    inputSchema: z.object({
      exportPath: z.string().min(1).describe('The export this metadata is for.'),
      transcriptPath: z.string().min(1).describe('Its transcript — figures are checked against it.'),
      metadata: z.object({ youtube: platformText.extend({ title: z.string() }), instagram: platformText, tiktok: platformText }),
      force: z.boolean().optional()
    })
  }
];

const NAMES: ReadonlySet<string> = new Set(PUBLISH_TOOLS.map((t) => t.name));
export const isPublishTool = (name: string) => NAMES.has(name);
export const getPublishTools = () => PUBLISH_TOOLS;

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

export async function executePublishTool(name: string, args: Record<string, any>, context: PublishContext = {}): Promise<any> {
  try {
    if (name === 'upload_metadata_brief') {
      const text = await readTranscriptText(args.transcriptPath);
      const similar = context.privateDir ? await findSimilarVideos(context.privateDir, text, 3, [args.transcriptPath]) : null;
      return {
        success: true,
        hook: firstSentence(text),
        figuresSaid: [...new Set(figures(text))],
        transcript: text.length > 8000 ? `${text.slice(0, 8000)} …` : text,
        pastVideos: (similar?.results ?? []).map((r: any) => ({ title: r.title, hook: r.hookLine, views30d: r.views30d ?? null, stayedToWatchPercent: r.stayedToWatchPercent ?? null })),
        limits: { ...LIMITS, hashtags: HASHTAGS },
        rules: [
          'Exact facts from the transcript only. Any number must be one the speaker said (and is checked).',
          'No call to action of any kind (no "link in bio", "call us", "visit", "learn more", "subscribe"…). BuildX never authors one; the end card carries it.',
          'Never write "drywall" — BuildX walls are thin coat plaster.',
          'Never name a person or place that was not confirmed on camera (people.md).',
          'Title: lead with a specific number or the stakes; do not open with "BuildX"; no "Meet The <Model>".',
          `3–5 hashtags per platform; YouTube must include #shorts.`
        ]
      };
    }
    if (name === 'save_upload_metadata') {
      const meta = args.metadata as UploadMetadata;
      const transcript = await readTranscriptText(args.transcriptPath);
      const check = checkMetadata(meta, transcript);
      if (check.errors.length) return { success: false, saved: false, errors: check.errors, warnings: check.warnings };
      const dir = path.join(path.dirname(args.exportPath), 'Platform Versions');
      const base = path.basename(args.exportPath, path.extname(args.exportPath));
      const json = path.join(dir, `${base} - Upload.json`);
      const md = path.join(dir, `${base} - Upload.md`);
      if (!args.force && (existsSync(json) || existsSync(md))) {
        return { success: false, saved: false, errors: [`${json} already exists — pass force:true to replace it.`], warnings: check.warnings };
      }
      await mkdir(dir, { recursive: true });
      const record = {
        description: 'Upload metadata per platform. "posted" is the full text with hashtags, ready to paste.',
        export: args.exportPath,
        createdAt: new Date().toISOString(),
        youtube: { ...meta.youtube, posted: composed(meta.youtube) },
        instagram: { ...meta.instagram, posted: composed(meta.instagram) },
        tiktok: { ...meta.tiktok, posted: composed(meta.tiktok) },
        warnings: check.warnings
      };
      await writeAtomic(json, JSON.stringify(record, null, 2) + '\n');
      await writeAtomic(md, metadataMarkdown(base, meta, check));
      return { success: true, saved: true, json, md, warnings: check.warnings };
    }
    return { success: false, error: `Unknown publish tool '${name}'` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
