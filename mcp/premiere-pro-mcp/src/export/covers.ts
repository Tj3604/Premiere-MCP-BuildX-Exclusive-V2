/**
 * Cover-frame candidates for the thumbnail: scripts/cover-frames.py scores a frame
 * every 0.5s (face via YuNet, sharpness, contrast, brightness — skipping the
 * first-frame card and the end card); this picks the best few, spread apart, and
 * has the script save them full-resolution beside the export. Reads the video only.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface CoverSample {
  t: number;
  face: number;
  faceBox: number[] | null;
  sharp: number;
  contrast: number;
  bright: number;
  meanLuma: number;
}

export interface ScoredSample extends CoverSample {
  score: number;
}

/** Face matters most; a frame with no face can still win on sharpness and contrast. */
export function coverScore(s: CoverSample): number {
  return Math.round((0.5 * s.face + 0.25 * s.sharp + 0.15 * s.contrast + 0.1 * s.bright) * 1000) / 1000;
}

/** Best `count` samples, each at least `minGap` seconds from the others, in time order. */
export function selectCovers(samples: CoverSample[], count = 5, minGap = 2): ScoredSample[] {
  const scored = samples.map((s) => ({ ...s, score: coverScore(s) })).sort((a, b) => b.score - a.score || a.t - b.t);
  const picked: ScoredSample[] = [];
  for (const s of scored) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p.t - s.t) >= minGap)) picked.push(s);
  }
  return picked.sort((a, b) => a.t - b.t);
}

export interface CoverPaths {
  python: string;
  script: string;
  model: string;
}

export function coverPaths(repoRoot: string, privateDir: string, env: NodeJS.ProcessEnv = process.env): CoverPaths {
  return {
    python: env.BUILDX_CV_PYTHON || path.join(os.homedir(), '.local/share/uv/tools/scenedetect/bin/python'),
    script: path.join(repoRoot, 'scripts', 'cover-frames.py'),
    model: env.BUILDX_FACE_MODEL || path.join(privateDir, 'models', 'yunet.onnx')
  };
}

export async function pickCoverFrames(
  exportPath: string,
  paths: CoverPaths,
  { count = 5, minGapSeconds = 2 }: { count?: number; minGapSeconds?: number } = {}
): Promise<any> {
  for (const [what, p] of [['OpenCV Python (BUILDX_CV_PYTHON)', paths.python], ['face model (BUILDX_FACE_MODEL)', paths.model], ['cover-frames.py', paths.script]] as const) {
    if (!existsSync(p)) throw new Error(`Missing ${what}: ${p}`);
  }
  const { stdout } = await run(paths.python, [paths.script, 'score', exportPath, '--model', paths.model], { maxBuffer: 64 * 1024 * 1024 });
  const scored = JSON.parse(stdout) as { duration: number; width: number; height: number; samples: CoverSample[] };
  if (!scored.samples.length) throw new Error('No frames to score (the clip may be shorter than its cards).');
  const chosen = selectCovers(scored.samples, count, minGapSeconds);
  const outDir = path.join(path.dirname(exportPath), 'Cover Candidates');
  const name = path.basename(exportPath, path.extname(exportPath));
  const w = await run(paths.python, [paths.script, 'write', exportPath, '--times', chosen.map((c) => c.t).join(','), '--out-dir', outDir, '--name', name, '--model', paths.model]);
  const written = JSON.parse(w.stdout) as { written: Array<{ n: number; t: number; sampledAt: number; eyes: number | null; path: string }>; sheet: string | null };
  return {
    sampled: scored.samples.length,
    withFaces: scored.samples.filter((s) => s.face > 0).length,
    candidates: chosen.map((c, i) => {
      const out = written.written[i];
      // The script may have moved the frame up to 0.3s to avoid a blink.
      return { n: i + 1, t: out?.t ?? c.t, sampledAt: c.t, score: c.score, face: c.face, sharp: c.sharp, contrast: c.contrast, bright: c.bright, eyes: out?.eyes ?? null, path: out?.path ?? null };
    }),
    sheet: written.sheet,
    outDir
  };
}
