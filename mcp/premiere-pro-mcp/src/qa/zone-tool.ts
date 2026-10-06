/**
 * check_safe_zones: are graphics and captions clear of the Shorts / TikTok / Reels
 * interface? Reads only — never moves anything.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { textWidth } from '../captions/build.js';
import { SHORTS_LOGO_PLACEMENT } from './config.js';
import { Box, captionBox, judgeBox, judgeCells, Motion, Platform, roundBox, toFrame, Verdict } from './safe-zones.js';
import { visibleBox } from './visible-box.js';

export type RunScript = (script: string) => Promise<any>;

export const ZONE_TOOLS = [
  {
    name: 'check_safe_zones',
    description:
      'Safe-zone check for 9:16 shorts (knowledge/buildx/safe-zones.md): flags any graphic or caption in the Shorts / TikTok / Reels UI zones. Graphics are measured by their visible pixels (alpha, sampled across the clip), mapped through each clip\'s Motion Position/Scale/Anchor. With sequenceId: every clip on V2 and up (V1 is footage). With files: renders before import, assumed full-frame. With srtPath: each cue\'s measured width at the Thomas Default line (y909). pass = inside x108–972 × y192–1728; warn = past a side line; fail = in a platform UI zone. The approved upper-right logo passes. Reads only.',
    inputSchema: z
      .object({
        sequenceId: z.string().optional().describe('Check the graphics on this sequence (V2 and up).'),
        files: z.array(z.string()).optional().describe('Absolute paths of rendered graphics, checked as full-frame overlays.'),
        srtPath: z.string().optional().describe('An .srt to check as Thomas Default captions.'),
        platforms: z.array(z.enum(['shorts', 'tiktok', 'reels'])).optional().describe('Default all three.'),
        captionTopY: z.number().optional().describe('Caption line top in 1080x1920 pixels. Default 909.')
      })
      .refine((a) => a.sequenceId || a.files?.length || a.srtPath, { message: 'Pass sequenceId, files or srtPath.' })
  }
];

const NAMES: ReadonlySet<string> = new Set(ZONE_TOOLS.map((t) => t.name));
export const isZoneTool = (name: string) => NAMES.has(name);
export const getZoneTools = () => ZONE_TOOLS;

interface ItemResult {
  kind: 'graphic' | 'caption' | 'file';
  name: string;
  verdict: Verdict;
  box?: Box;
  zones?: Record<string, string[]>;
  note?: string;
  start?: number;
  end?: number;
}

function flatten(r: ReturnType<typeof judgeBox>): Record<string, string[]> {
  return Object.fromEntries(r.platforms.filter((p) => p.zones.length).map((p) => [p.platform, p.zones]));
}

export function isApprovedLogo(name: string, motion: Motion, frameWidth: number, frameHeight: number): boolean {
  const L = SHORTS_LOGO_PLACEMENT;
  return (
    /buildx logo/i.test(name) &&
    frameWidth * L.frameHeight === frameHeight * L.frameWidth &&
    Math.abs(motion.position[0] - L.position[0]) < 0.005 &&
    Math.abs(motion.position[1] - L.position[1]) < 0.005 &&
    Math.abs(motion.scale - L.scale * (frameWidth / L.frameWidth)) < 0.6
  );
}

export async function executeZoneTool(name: string, args: Record<string, any>, runScript?: RunScript): Promise<any> {
  if (name !== 'check_safe_zones') return { success: false, error: `Unknown tool '${name}'` };
  const platforms: Platform[] = args.platforms ?? ['shorts', 'tiktok', 'reels'];
  const items: ItemResult[] = [];
  const problems: string[] = [];

  try {
    if (args.sequenceId) {
      if (!runScript) return { success: false, error: 'Checking a sequence needs the Premiere bridge.' };
      const raw = await runScript(`try {
        var seq = __findSequence(${JSON.stringify(args.sequenceId)});
        if (!seq) return JSON.stringify({ success: false, error: "Sequence not found" });
        var st = seq.getSettings();
        function prop(clip, name) {
          for (var i = 0; i < clip.components.numItems; i++) {
            var c = clip.components[i];
            if (c.displayName !== "Motion") continue;
            for (var j = 0; j < c.properties.numItems; j++) if (c.properties[j].displayName === name) return c.properties[j];
          }
          return null;
        }
        var clips = [];
        for (var t = 1; t < seq.videoTracks.numTracks; t++) {
          var tr = seq.videoTracks[t];
          for (var k = 0; k < tr.clips.numItems; k++) {
            var c = tr.clips[k], p = "", pos = prop(c, "Position"), sc = prop(c, "Scale"), an = prop(c, "Anchor Point");
            try { p = c.projectItem ? c.projectItem.getMediaPath() : ""; } catch (e) {}
            clips.push({ track: t, name: c.name, path: p, start: c.start.seconds, end: c.end.seconds,
              position: pos ? pos.getValue() : null, scale: sc ? sc.getValue() : null, anchor: an ? an.getValue() : null,
              keyframed: !!((pos && pos.isTimeVarying()) || (sc && sc.isTimeVarying())) });
          }
        }
        return JSON.stringify({ success: true, name: seq.name, width: st.videoFrameWidth, height: st.videoFrameHeight, clips: clips });
      } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }`);
      const seq = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!seq?.success) return { success: false, error: seq?.error ?? 'Could not read the sequence' };
      if (seq.width * 16 !== seq.height * 9) problems.push(`"${seq.name}" is ${seq.width}x${seq.height}, not 9:16 — the zones below assume a vertical frame.`);

      const boxes = new Map<string, Awaited<ReturnType<typeof visibleBox>>>();
      for (const c of seq.clips) {
        const base = { kind: 'graphic' as const, name: `V${c.track + 1} ${c.name}`, start: c.start, end: c.end };
        if (!c.path || !existsSync(c.path)) {
          items.push({ ...base, verdict: 'warn', note: c.path ? `media not readable at ${c.path}` : 'no media file (nested sequence, title or generated item) — check by eye' });
          continue;
        }
        if (!boxes.has(c.path)) boxes.set(c.path, await visibleBox(c.path));
        const vb = boxes.get(c.path)!;
        if (!vb.box) { items.push({ ...base, verdict: 'pass', note: 'no visible pixels in the sampled frames' }); continue; }
        // Premiere's Position is normalised in this build; older builds report pixels.
        const pos: [number, number] = Array.isArray(c.position) && c.position[0] > 2 ? [c.position[0] / seq.width, c.position[1] / seq.height] : (c.position ?? [0.5, 0.5]);
        const anchor: [number, number] | undefined = Array.isArray(c.anchor) ? (c.anchor[0] > 2 ? [c.anchor[0] / vb.info.width, c.anchor[1] / vb.info.height] : c.anchor) : undefined;
        const motion: Motion = { position: pos, scale: typeof c.scale === 'number' ? c.scale : 100, ...(anchor ? { anchor } : {}) };
        const box = roundBox(toFrame(vb.box, vb.info.width, vb.info.height, motion, seq.width, seq.height));
        if (isApprovedLogo(c.name, motion, seq.width, seq.height)) {
          items.push({ ...base, verdict: 'pass', box, note: `approved logo placement — ${SHORTS_LOGO_PLACEMENT.label}` });
          continue;
        }
        const cells = vb.cells.map((cell) => toFrame(cell, vb.info.width, vb.info.height, motion, seq.width, seq.height));
        const r = judgeCells(cells, seq.width, seq.height, platforms);
        items.push({ ...base, verdict: r.verdict, box, zones: flatten(r), ...(c.keyframed ? { note: 'Position/Scale is keyframed — checked at its current value only' } : {}) });
      }
    }

    for (const file of args.files ?? []) {
      if (!existsSync(file)) { items.push({ kind: 'file', name: file, verdict: 'fail', note: 'file not found' }); continue; }
      const vb = await visibleBox(file);
      if (!vb.box) { items.push({ kind: 'file', name: file, verdict: 'pass', note: 'no visible pixels in the sampled frames' }); continue; }
      if (vb.info.width * 16 !== vb.info.height * 9) problems.push(`${file} is ${vb.info.width}x${vb.info.height}, not 9:16.`);
      const r = judgeCells(vb.cells, vb.info.width, vb.info.height, platforms);
      items.push({ kind: 'file', name: file, verdict: r.verdict, box: vb.box, zones: flatten(r) });
    }

    if (args.srtPath) {
      const srt = await readFile(args.srtPath, 'utf8');
      for (const block of srt.split(/\r?\n\r?\n/)) {
        const lines = block.trim().split(/\r?\n/);
        const timing = lines.find((l) => l.includes('-->'));
        if (!timing) continue;
        const text = lines.slice(lines.indexOf(timing) + 1);
        const widest = Math.max(...text.map((l) => textWidth(l)));
        const box = roundBox(captionBox(widest, 1080, args.captionTopY ?? 909, 100 * text.length));
        const r = judgeBox(box, 1080, 1920, platforms);
        const note = text.length > 1 ? `${text.length} lines in one cue — renders stacked` : widest > 745 ? `${Math.round(widest)}px wide — past the 745px line, Premiere may wrap it` : undefined;
        if (r.verdict !== 'pass' || note) items.push({ kind: 'caption', name: `${lines[0]}: ${text.join(' / ')}`, verdict: note && r.verdict === 'pass' ? 'warn' : r.verdict, box, zones: flatten(r), ...(note ? { note } : {}) });
      }
      if (!items.some((i) => i.kind === 'caption')) items.push({ kind: 'caption', name: args.srtPath, verdict: 'pass', note: 'every cue fits the safe width at the caption line' });
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const count = (v: Verdict) => items.filter((i) => i.verdict === v).length;
  return {
    success: true,
    verdict: count('fail') ? 'fail' : count('warn') ? 'warn' : 'pass',
    pass: count('pass'),
    warn: count('warn'),
    fail: count('fail'),
    items,
    problems,
    rules: 'safe x108–972 × y192–1728 (safe-zones.md); Reels also y247–1453 and the rail x>932 below y1380'
  };
}
