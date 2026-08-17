#!/usr/bin/env node
/**
 * Turn a list of keep-ranges into exact `add_to_timeline` arguments.
 *
 * This exists so the agent never does timeline arithmetic by hand. It handles
 * sorting, overlap merging, handle padding, frame snapping, and the cumulative
 * timeline offsets that make clips butt up against each other with no gaps.
 *
 * Usage:
 *   node scripts/plan-cut.mjs --keep "1.2-5.4,10.0-14.2" [options]
 *   node scripts/plan-cut.mjs --keep-file keeps.json [options]
 *
 * Options:
 *   --transcript <path>   .words.json — clamps ranges to real media duration
 *   --fps <n>             Frame rate to snap to (default 30)
 *   --pad <seconds>       Handle added to each side of every range (default 0.05)
 *   --start <seconds>     Where the first clip lands on the timeline (default 0)
 *   --track <n>           Video track index (default 0)
 *   --sequence-id <id>    Sequence ID, passed straight through
 *   --project-item-id <id> Project item ID, passed straight through
 *
 * FCP7 XML output (optional):
 *   --xml <path>          Also write an xmeml v5 timeline to <path>
 *   --media <path>        Absolute path to the source file. Required with --xml.
 *   --width <n>           Sequence width (default 1080)
 *   --height <n>          Sequence height (default 1920)
 *   --sequence-name <s>   Sequence name inside the XML (default "BuildX Rough Cut")
 *
 * Output: JSON with a `calls` array. Each entry is the argument object for one
 * `add_to_timeline` MCP call, in order.
 *
 * WHY BOTH OUTPUTS
 * The `calls` array drives the source-monitor path (set_source_in_out ->
 * overwrite_from_source), which stays the fallback for single-clip work. The XML
 * is the interchange path for multi-cut assemblies: it carries rational time
 * (frames over an exact rate) rather than the seconds-as-float the tool calls
 * take, so 29.97 cannot drift. Both are generated from the same integer frame
 * numbers, so they describe the same cut.
 *
 * XML import is a manual `File > Import` in Premiere. `import_sequences` is a
 * no-op. That human step is expected, not a bug to work around.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** "60000/1001" -> 59.94005994..., "30" -> 30. */
function parseFps(raw) {
  if (typeof raw === 'string' && raw.includes('/')) {
    const [num, den] = raw.split('/').map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
    return NaN;
  }
  return Number(raw);
}

// The broadcast rates are exact fractions, not decimals. Keeping the rational
// form alongside the float is what lets the XML carry frame-exact time — a
// float 29.97 accumulates about a frame every 33 seconds against 30000/1001.
const NTSC_RATIONALS = {
  '23.976': { num: 24000, den: 1001 },
  '29.97': { num: 30000, den: 1001 },
  '47.952': { num: 48000, den: 1001 },
  '59.94': { num: 60000, den: 1001 },
};

/** "30000/1001" or "29.97" or "30" -> {num, den}. */
function parseFpsRational(raw) {
  const text = String(raw).trim();
  if (text.includes('/')) {
    const [num, den] = text.split('/').map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return { num, den };
  }
  if (NTSC_RATIONALS[text]) return NTSC_RATIONALS[text];
  const n = Number(text);
  if (Number.isInteger(n) && n > 0) return { num: n, den: 1 };
  // A non-integer decimal that is not a known NTSC rate. Match it to one if it
  // is within half a frame, otherwise represent it exactly as given.
  for (const r of Object.values(NTSC_RATIONALS)) {
    if (Math.abs(r.num / r.den - n) < 0.005) return r;
  }
  return { num: Math.round(n * 1000), den: 1000 };
}

function parseArgs(argv) {
  const args = {
    fps: 30,
    pad: 0.05,
    start: 0,
    track: 0,
    sequenceId: '<SEQUENCE_ID>',
    projectItemId: '<PROJECT_ITEM_ID>',
    fpsRational: { num: 30, den: 1 },
    width: 1080,
    height: 1920,
    sequenceName: 'BuildX Rough Cut',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--keep': args.keep = value; i++; break;
      case '--keep-file': args.keepFile = value; i++; break;
      case '--transcript': args.transcript = value; i++; break;
      // Accept rationals ("60000/1001") as well as plain numbers. Rounding NTSC
      // rates to 2dp drifts ~7 frames over a 20-minute source.
      case '--fps': args.fps = parseFps(value); args.fpsRational = parseFpsRational(value); i++; break;
      case '--xml': args.xml = value; i++; break;
      case '--media': args.media = value; i++; break;
      case '--width': args.width = Number(value); i++; break;
      case '--height': args.height = Number(value); i++; break;
      case '--sequence-name': args.sequenceName = value; i++; break;
      case '--pad': args.pad = Number(value); i++; break;
      case '--start': args.start = Number(value); i++; break;
      case '--track': args.track = Number(value); i++; break;
      case '--sequence-id': args.sequenceId = value; i++; break;
      case '--project-item-id': args.projectItemId = value; i++; break;
      default: break;
    }
  }
  return args;
}

/** Accepts "1.2-5.4,10-14" or JSON [[1.2,5.4],[10,14]] / [{start,end}]. */
function parseRanges(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed).map((r) =>
      Array.isArray(r) ? { start: Number(r[0]), end: Number(r[1]) } : { start: Number(r.start), end: Number(r.end) }
    );
  }
  return trimmed
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      // Split on the hyphen that separates the two numbers, tolerating "1.2 - 5.4".
      const match = chunk.match(/^([0-9]*\.?[0-9]+)\s*-\s*([0-9]*\.?[0-9]+)$/);
      if (!match) throw new Error(`Cannot parse range: "${chunk}" (expected "start-end")`);
      return { start: Number(match[1]), end: Number(match[2]) };
    });
}

function toFrame(seconds, fps) {
  return Math.round(seconds * fps);
}

/**
 * Seconds for a SOURCE in/out point, aimed at the MIDDLE of the frame.
 *
 * Premiere floors source points to frames. Emitting the exact boundary is
 * unsafe: 61/30 = 2.033333... and truncating that decimal lands just below the
 * boundary, so it floors to frame 60 and the clip comes up one frame short —
 * a black flash on the timeline. The midpoint leaves half a frame of headroom.
 */
function sourceFrameToSeconds(frame, fps) {
  return Number(((frame + 0.5) / fps).toFixed(4));
}

/**
 * Seconds for a TIMELINE position, aimed at the exact frame boundary.
 *
 * Timeline placement ROUNDS rather than floors, so the midpoint used above
 * would sit exactly on the .5 tie point and push every clip a frame late.
 * The boundary value is safe here: rounding absorbs the truncation error in
 * either direction.
 */
function timelineFrameToSeconds(frame, fps) {
  return Number((frame / fps).toFixed(4));
}

/**
 * Build an xmeml v5 timeline from the same integer frames the calls use.
 *
 * Time is emitted as exact rationals: at rate num/den, frame F is F*den/num
 * seconds. Nothing here round-trips through a float, which is the entire point
 * of taking this path instead of the tool calls.
 */
async function writeXmlTimeline({ cuts, args, warnings }) {
  const lib = await import('@chatoctopus/timeline');
  const { createTimeline, writeXMEML, validateTimeline, hasErrors, probeMediaReference, rational } = lib;

  const { num, den } = args.fpsRational;
  const mediaPath = path.resolve(args.media);

  // Probe fills availableRange and streamInfo. If ffprobe cannot read the file
  // we still emit a valid timeline, just a thinner reference — and we say so.
  let mediaReference;
  try {
    mediaReference = await probeMediaReference(mediaPath);
  } catch (err) {
    warnings.push(`Could not probe ${path.basename(mediaPath)} (${err.message}). Emitting a bare media reference.`);
    mediaReference = { type: 'external', targetUrl: `file://${mediaPath}`, name: path.basename(mediaPath), mediaKind: 'video' };
  }

  const items = cuts.map((c, i) => ({
    kind: 'clip',
    name: `${path.basename(mediaPath, path.extname(mediaPath))}_${String(i + 1).padStart(3, '0')}`,
    mediaReference,
    // seconds = frames * den / num, held as an exact fraction
    sourceRange: {
      startTime: rational(c.inFrame * den, num),
      duration: rational(c.frames * den, num),
    },
    enabled: true,
  }));

  const timeline = createTimeline({
    name: args.sequenceName,
    format: {
      width: args.width,
      height: args.height,
      frameRate: rational(num, den),
      audioRate: 48000,
      audioChannels: 2,
    },
    tracks: [{ kind: 'video', name: 'V1', items, enabled: true }],
  });

  const issues = validateTimeline(timeline);
  if (hasErrors(issues)) {
    const detail = issues.map((i) => `${i.severity ?? 'error'}: ${i.message ?? JSON.stringify(i)}`).join('\n  ');
    throw new Error(`Refusing to write an invalid timeline:\n  ${detail}`);
  }
  for (const issue of issues ?? []) {
    warnings.push(`timeline validate: ${issue.message ?? JSON.stringify(issue)}`);
  }

  const xml = writeXMEML(timeline, {
    onWarning: (w) => warnings.push(`xmeml: ${w}`),
  });
  writeFileSync(path.resolve(args.xml), xml, 'utf8');

  return {
    path: path.resolve(args.xml),
    bytes: Buffer.byteLength(xml, 'utf8'),
    frameRate: `${num}/${den}`,
    validateIssues: (issues ?? []).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.xml && !args.media) {
    throw new Error('--xml needs --media <absolute path to the source file>.');
  }

  const raw = args.keepFile ? readFileSync(args.keepFile, 'utf8') : args.keep;
  if (!raw) {
    console.error('Provide --keep "start-end,start-end" or --keep-file <path>. See header for usage.');
    process.exit(1);
  }

  if (!Number.isFinite(args.fps) || args.fps <= 0) {
    console.error(`--fps must be a positive number (got ${args.fps})`);
    process.exit(1);
  }

  let mediaDuration = Infinity;
  if (args.transcript) {
    const words = JSON.parse(readFileSync(args.transcript, 'utf8'));
    if (Array.isArray(words) && words.length) mediaDuration = words[words.length - 1].end;
  }

  let ranges = parseRanges(raw);

  for (const r of ranges) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end)) {
      throw new Error(`Range has non-numeric bounds: ${JSON.stringify(r)}`);
    }
    if (r.end <= r.start) {
      throw new Error(`Range end must be after start: ${JSON.stringify(r)}`);
    }
  }

  // Pad first, then merge — padding can make neighbours overlap, and two clips
  // pulled from overlapping source ranges would repeat words on the timeline.
  ranges = ranges
    .map((r) => ({
      start: Math.max(0, r.start - args.pad),
      end: Math.min(mediaDuration, r.end + args.pad),
    }))
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  const warnings = [];
  if (merged.length !== ranges.length) {
    warnings.push(`Merged ${ranges.length} ranges into ${merged.length} after padding overlaps.`);
  }

  // Everything below is computed in whole frames. Seconds are only re-derived
  // at the moment of emitting a call, so no rounding error can accumulate.
  let cursorFrame = toFrame(args.start, args.fps);
  const calls = [];
  const cuts = []; // integer frames, shared by the calls and the XML
  let totalFrames = 0;

  for (const r of merged) {
    const inFrame = toFrame(r.start, args.fps);
    const outFrame = toFrame(r.end, args.fps);
    const frames = outFrame - inFrame;

    // A range shorter than one frame would collapse to nothing in Premiere.
    if (frames < 1) {
      warnings.push(`Skipped sub-frame range ${r.start.toFixed(2)}-${r.end.toFixed(2)}.`);
      continue;
    }

    calls.push({
      sequenceId: args.sequenceId,
      projectItemId: args.projectItemId,
      trackIndex: args.track,
      time: timelineFrameToSeconds(cursorFrame, args.fps),
      sourceInPoint: sourceFrameToSeconds(inFrame, args.fps),
      sourceOutPoint: sourceFrameToSeconds(outFrame, args.fps),
      insertMode: 'overwrite',
    });
    cuts.push({ inFrame, outFrame, frames, timelineFrame: cursorFrame });

    cursorFrame += frames;
    totalFrames += frames;
  }

  const xmlResult = args.xml ? await writeXmlTimeline({ cuts, args, warnings }) : null;

  console.log(JSON.stringify({
    ok: true,
    clipCount: calls.length,
    fps: args.fps,
    totalDurationSeconds: Number((totalFrames / args.fps).toFixed(3)),
    totalFrames,
    timelineEndSeconds: Number((cursorFrame / args.fps).toFixed(3)),
    sourceDurationSeconds: Number.isFinite(mediaDuration) ? Number(mediaDuration.toFixed(2)) : null,
    warnings,
    ...(xmlResult ? { xml: xmlResult, importStep: 'Premiere: File > Import — import_sequences is a no-op' } : {}),
    calls,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
