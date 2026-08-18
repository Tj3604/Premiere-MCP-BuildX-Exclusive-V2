#!/usr/bin/env node
/**
 * Prepare audio for TRANSCRIPTION ONLY.
 *
 * Extract -> (denoise) -> normalize -> trim leading silence -> 16k mono WAV.
 *
 * THIS NEVER REACHES THE EDIT. Denoised audio is a transcription input and
 * nothing else; testimonial audio ships exactly as recorded. Output goes to
 * transcription-audio/ and source media is never written to.
 *
 * Usage:
 *   node scripts/prep-audio.mjs <media> [options]
 *     --out-dir <dir>     default transcription-audio/
 *     --target <lufs>     loudness target (default -16)
 *     --snr-threshold <n> with --auto-denoise, denoise below this SNR (default 30)
 *     --force-denoise     denoise anyway (OFF by default — it makes ASR worse)
 *     --auto-denoise      decide from measured SNR
 *     --no-denoise        never denoise (the default)
 *     --no-trim           keep leading silence
 *     --start <t> --duration <t>   work on a segment
 *     --keep-stages       keep the intermediate files for A/B comparison
 *
 * ORDER MATTERS: denoise first, then normalize. Denoising removes energy and
 * changes the RMS, so normalising first would leave the level wrong.
 *
 * DENOISE IS OFF BY DEFAULT, AND THAT IS A MEASURED DECISION.
 *
 * DeepFilterNet raises SNR dramatically and makes transcription WORSE. Measured
 * against a clean-speech reference, with real jobsite ambience mixed under
 * studio speech to 9.9 dB SNR:
 *
 *   noisy, untouched         WER 12.36%
 *   noisy + normalize only   WER 11.61%   <- best
 *   noisy + denoise only     WER 17.60%
 *   noisy + full chain       WER 17.23%
 *
 * Denoising lifted SNR from 9.9 dB to 33.4 dB and still cost ~5 WER points,
 * with substitutions rising from 10 to 22. It removes noise at the price of
 * distorting speech, and wav2vec2 alignment cares more about the distortion
 * than the noise. On already-clean studio audio it also invents words —
 * "you go elsewhere wherever you're going", "that one's a slight 750".
 *
 * So: normalize and trim by default, denoise only if you have a specific reason
 * and have measured that it helps on that material. --force-denoise is kept for
 * exactly that experiment.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, mkdtemp, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// DeepFilterNet is trained at 48 kHz. Feed it anything else and it resamples
// internally, which is lossy for no benefit.
const DENOISE_RATE = 48000;
// Whisper/WhisperX consume 16 kHz mono.
const ASR_RATE = 16000;

function parseArgs(argv) {
  // Denoise defaults to OFF. Measured, not assumed — see the header note.
  const args = { target: -16, snrThreshold: 30, denoise: 'never', trim: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--out-dir': args.outDir = argv[++i]; break;
      case '--target': args.target = Number(argv[++i]); break;
      case '--snr-threshold': args.snrThreshold = Number(argv[++i]); break;
      case '--force-denoise': args.denoise = 'always'; break;
      case '--auto-denoise': args.denoise = 'auto'; break;
      case '--no-denoise': args.denoise = 'never'; break;
      case '--no-trim': args.trim = false; break;
      case '--start': args.start = argv[++i]; break;
      case '--duration': args.duration = argv[++i]; break;
      case '--keep-stages': args.keepStages = true; break;
      default: rest.push(argv[i]);
    }
  }
  args.input = rest[0];
  return args;
}

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}\n${(stderr || stdout).slice(-1500)}`));
    });
  });
}

function resolveBinary(name) {
  const local = path.join(homedir(), '.local', 'bin', name);
  return existsSync(local) ? local : name;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Peak / RMS / noise floor, and the SNR estimate the denoise gate uses.
 *
 * astats' own "Noise floor dB" is not usable here: any window containing true
 * digital silence reports -inf, which is common in recorder files with gaps.
 * Instead this frames the audio into ~0.4s windows, takes the 10th percentile
 * of window RMS as the noise floor and the 90th as the speech level, and calls
 * the difference SNR. Robust to both silence and the odd loud transient.
 */
async function measure(wav) {
  const { stderr } = await run('ffmpeg', ['-i', wav, '-ac', '1', '-af', 'astats', '-f', 'null', '-']);
  const grab = (label) => {
    const m = new RegExp(`${label}:\\s*(-?[\\d.]+|-?inf)`).exec(stderr);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? Number(v.toFixed(2)) : null;
  };

  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-i', wav,
    '-af', 'astats=metadata=1:reset=20,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-',
  ]);
  const windows = [...stdout.matchAll(/RMS_level=(-?[\d.]+|-?inf)/g)]
    .map((m) => Number(m[1]))
    .filter(Number.isFinite);
  windows.sort((a, b) => a - b);

  const noiseFloor = percentile(windows, 10);
  const speech = percentile(windows, 90);

  return {
    peakDb: grab('Peak level dB'),
    rmsDb: grab('RMS level dB'),
    noiseFloorDb: noiseFloor === null ? null : Number(noiseFloor.toFixed(2)),
    speechDb: speech === null ? null : Number(speech.toFixed(2)),
    snrDb: noiseFloor !== null && speech !== null ? Number((speech - noiseFloor).toFixed(2)) : null,
    windowsMeasured: windows.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/prep-audio.mjs <media> [--force-denoise] [--no-trim]');
    process.exit(1);
  }
  const inputPath = path.resolve(args.input);
  if (!existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outDir = path.resolve(args.outDir ?? path.join(PROJECT_ROOT, 'transcription-audio'));
  await mkdir(outDir, { recursive: true });
  const finalPath = path.join(outDir, `${baseName}.asr.wav`);

  const workDir = await mkdtemp(path.join(tmpdir(), 'prepaudio-'));
  const stages = [];
  try {
    // 1. Extract at the denoiser's native rate.
    const extracted = path.join(workDir, 'a_extracted.wav');
    const ff = ['-v', 'error'];
    if (args.start) ff.push('-ss', String(args.start));
    if (args.duration) ff.push('-t', String(args.duration));
    ff.push('-i', inputPath, '-vn', '-ac', '1', '-ar', String(DENOISE_RATE), '-y', extracted);
    await run('ffmpeg', ff);
    stages.push({ stage: 'extract', file: extracted, ...(await measure(extracted)) });

    const before = stages[0];
    if (before.peakDb !== null && before.peakDb < -70) {
      throw new Error(
        `Audio is effectively silent (peak ${before.peakDb} dBFS). ` +
        'Camera ISOs often carry a silent track — use the recorder file instead.'
      );
    }

    // 2. Denoise, but only if the measurement says it is worth it.
    let current = extracted;
    let denoiseDecision;

    // Never let an unmeasurable SNR quietly become "clean enough, skip it".
    // That is the failure this whole script is supposed to prevent.
    if (args.denoise === 'auto' && before.snrDb === null) {
      throw new Error(
        'Could not measure SNR, so the denoise decision cannot be made automatically.\n' +
        `  (windows measured: ${before.windowsMeasured ?? 0})\n` +
        'Re-run with --force-denoise or --no-denoise to decide explicitly.'
      );
    }

    const shouldDenoise =
      args.denoise === 'always' ||
      (args.denoise === 'auto' && before.snrDb < args.snrThreshold);

    if (shouldDenoise) {
      const dnDir = path.join(workDir, 'dn');
      await mkdir(dnDir, { recursive: true });
      await run(resolveBinary('deepFilter'), ['-o', dnDir, current]);
      const produced = (await readdir(dnDir)).find((f) => f.endsWith('.wav'));
      if (!produced) throw new Error('DeepFilterNet produced no output.');
      current = path.join(dnDir, produced);
      denoiseDecision = args.denoise === 'always'
        ? 'applied (forced)'
        : `applied (SNR ${before.snrDb} dB < ${args.snrThreshold} dB threshold)`;
      stages.push({ stage: 'denoise', file: current, ...(await measure(current)) });
    } else {
      denoiseDecision = args.denoise === 'never'
        ? 'skipped (--no-denoise)'
        : `skipped (SNR ${before.snrDb} dB >= ${args.snrThreshold} dB threshold — already clean)`;
    }

    // 3. Normalize AFTER denoising, because denoising moved the level.
    const normalized = path.join(workDir, 'c_normalized.wav');
    await run(resolveBinary('ffmpeg-normalize'), [
      current, '-o', normalized, '-nt', 'ebu', '-t', String(args.target),
      '-ar', String(ASR_RATE), '-f', '-q',
    ]);
    current = normalized;
    stages.push({ stage: 'normalize', file: current, ...(await measure(current)) });

    // 4. Trim leading silence only. Trailing silence costs nothing to transcribe
    //    and cutting it risks clipping a final word.
    if (args.trim) {
      const trimmed = path.join(workDir, 'd_trimmed.wav');
      await run('ffmpeg', [
        '-v', 'error', '-i', current,
        '-af', 'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB',
        '-ar', String(ASR_RATE), '-ac', '1', '-y', trimmed,
      ]);
      current = trimmed;
      stages.push({ stage: 'trim', file: current, ...(await measure(current)) });
    }

    if (existsSync(finalPath)) {
      throw new Error(`Refusing to overwrite ${finalPath}.`);
    }
    await copyFile(current, finalPath);

    if (args.keepStages) {
      for (const s of stages) {
        const dest = path.join(outDir, `${baseName}.${s.stage}.wav`);
        if (!existsSync(dest)) await copyFile(s.file, dest);
        s.kept = dest;
      }
    }

    const dur = async (f) => {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]);
      return Number(Number(stdout.trim()).toFixed(2));
    };

    console.log(JSON.stringify({
      ok: true,
      input: inputPath,
      output: finalPath,
      note: 'TRANSCRIPTION ONLY — never route this into the edit.',
      denoise: denoiseDecision,
      targetLufs: args.target,
      durationSeconds: await dur(finalPath),
      measurements: stages.map(({ file, ...rest }) => rest),
    }, null, 2));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
