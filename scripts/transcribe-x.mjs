#!/usr/bin/env node
/**
 * Transcribe raw footage to word-level timestamps using WhisperX.
 *
 * The WhisperX path. `transcribe.mjs` (hyperframes/whisper.cpp) is unchanged and
 * still the fallback until this is proven on real footage.
 *
 * Produces two files in transcripts/, same names and same schema as
 * transcribe.mjs so plan-cut.mjs consumes either without modification:
 *   <name>.words.json  — [{text,start,end,speaker?}] — `speaker` is additive
 *   <name>.md          — sentence-grouped, timecoded, readable. Read THIS to pick cuts.
 *
 * Why WhisperX: forced alignment against wav2vec2 gives word timings roughly an
 * order of magnitude tighter than whisper's own, and VAD gating stops the model
 * hallucinating text into the long thinking pauses in interview audio.
 *
 * Usage:
 *   node scripts/transcribe-x.mjs <media-file> [options]
 *     --model <name>       default large-v3. Use large-v3 for anything that
 *                          becomes a burned-in caption.
 *     --diarize            label speakers. Needs HF_TOKEN in .env.
 *     --speakers <n>       exact speaker count, if known
 *     --min-speakers <n>   / --max-speakers <n>
 *     --vad <silero|pyannote>   default silero
 *     --language <code>    default en
 *     --device <cpu|cuda>  default cpu
 *     --compute-type <t>   default int8 (float16 is GPU-only)
 *     --keep-audio         leave the extracted wav in place for inspection
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A new sentence starts after terminal punctuation, or after a pause this long.
// Matches transcribe.mjs so the two produce comparable .md files.
const PAUSE_SPLIT_SECONDS = 0.6;

// Anything quieter than this is silence for practical purposes, and whisper
// hallucinates into it. Checked before transcribing so a silent camera ISO
// reports as a media problem rather than an empty transcript.
const SILENCE_DBFS = -70;

function parseArgs(argv) {
  const args = {
    model: 'large-v3',
    vad: 'silero',
    language: 'en',
    device: 'cpu',
    computeType: 'int8',
    diarize: false,
    keepAudio: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--model': args.model = argv[++i]; break;
      case '--vad': args.vad = argv[++i]; break;
      case '--language': args.language = argv[++i]; break;
      case '--device': args.device = argv[++i]; break;
      case '--compute-type': args.computeType = argv[++i]; break;
      case '--speakers': args.speakers = Number(argv[++i]); break;
      case '--min-speakers': args.minSpeakers = Number(argv[++i]); break;
      case '--max-speakers': args.maxSpeakers = Number(argv[++i]); break;
      case '--diarize': args.diarize = true; break;
      case '--keep-audio': args.keepAudio = true; break;
      default: rest.push(argv[i]);
    }
  }
  args.input = rest[0];
  return args;
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}\n${stderr || stdout}`));
    });
  });
}

/** Read .env without adding a dependency. Only needed for HF_TOKEN. */
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * WhisperX lives in a uv tool venv, which is not on PATH for non-login shells.
 * Resolve it explicitly so this works from any parent process.
 */
function resolveWhisperx(needPyannote) {
  const binary = needPyannote ? 'whisperx-pyannote' : 'whisperx';
  const local = path.join(homedir(), '.local', 'bin', binary);
  return existsSync(local) ? local : binary; // fall back to PATH
}

function timecode(seconds) {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

async function measureLevel(wavPath) {
  const { stderr } = await run('ffmpeg', ['-i', wavPath, '-af', 'volumedetect', '-f', 'null', '-'])
    .catch((e) => ({ stderr: e.message }));
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  return {
    meanDb: mean ? Number(mean[1]) : null,
    maxDb: max ? Number(max[1]) : null,
  };
}

/**
 * Flatten WhisperX's segment tree into the flat word list plan-cut.mjs expects.
 *
 * WhisperX omits start/end on words it could not align — usually numerals and
 * symbols that wav2vec2 has no phoneme mapping for. Dropping them would silently
 * delete words from the transcript, so they are kept and their timing is
 * interpolated from the surrounding aligned words. The count is reported.
 */
function flattenWords(whisperxJson) {
  const words = [];
  let unaligned = 0;

  for (const segment of whisperxJson.segments ?? []) {
    const segSpeaker = segment.speaker;
    for (const w of segment.words ?? []) {
      const text = (w.word ?? w.text ?? '').trim();
      if (!text) continue;
      const hasTiming = Number.isFinite(w.start) && Number.isFinite(w.end);
      if (!hasTiming) unaligned++;
      const entry = {
        text,
        start: hasTiming ? w.start : null,
        end: hasTiming ? w.end : null,
      };
      const speaker = w.speaker ?? segSpeaker;
      if (speaker) entry.speaker = speaker;
      if (Number.isFinite(w.score)) entry.score = Number(w.score.toFixed(3));
      words.push(entry);
    }
  }

  // Interpolate the gaps. Walk forward filling starts, backward filling ends,
  // then split any run of unaligned words evenly across the hole they sit in.
  for (let i = 0; i < words.length; i++) {
    if (words[i].start !== null) continue;
    let j = i;
    while (j < words.length && words[j].start === null) j++;
    const before = i > 0 ? words[i - 1].end : 0;
    const after = j < words.length ? words[j].start : before;
    const span = Math.max(0, after - before);
    const step = span / (j - i + 1);
    for (let k = i; k < j; k++) {
      words[k].start = before + step * (k - i);
      words[k].end = before + step * (k - i + 1);
      words[k].interpolated = true;
    }
    i = j - 1;
  }

  return { words, unaligned };
}

/** Group a flat word list into sentence-ish lines. Splits on speaker change too. */
function groupIntoSentences(words) {
  const sentences = [];
  let current = null;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!current) {
      current = { start: word.start, end: word.end, speaker: word.speaker, words: [] };
    }
    current.words.push(word.text);
    current.end = word.end;

    const endsSentence = /[.!?]"?$/.test(word.text);
    const next = words[i + 1];
    const pauseAfter = next ? next.start - word.end : Infinity;
    const speakerChanges = next ? next.speaker !== current.speaker : false;

    if (endsSentence || pauseAfter >= PAUSE_SPLIT_SECONDS || speakerChanges || !next) {
      current.text = current.words.join(' ');
      sentences.push(current);
      current = null;
    }
  }
  return sentences;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input) {
    console.error('Usage: node scripts/transcribe-x.mjs <media-file> [--model large-v3] [--diarize]');
    process.exit(1);
  }

  const mediaPath = path.resolve(args.input);
  if (!existsSync(mediaPath)) {
    console.error(`Media file not found: ${mediaPath}`);
    process.exit(1);
  }

  const env = loadEnv();
  const hfToken = env.HF_TOKEN || process.env.HF_TOKEN;
  if (args.diarize && !hfToken) {
    console.error(
      'Diarization needs a HuggingFace token.\n' +
      '  1. Accept the terms on pyannote/segmentation-3.0 and pyannote/speaker-diarization-3.1\n' +
      '  2. Put HF_TOKEN=hf_xxx in .env (already gitignored)\n' +
      'Re-run without --diarize to transcribe with no speaker labels.'
    );
    process.exit(1);
  }

  // Diarization is pyannote-only, so it needs the patched loader either way.
  const needPyannote = args.diarize || args.vad === 'pyannote';
  const whisperxBin = resolveWhisperx(needPyannote);

  const baseName = path.basename(mediaPath, path.extname(mediaPath));
  const outDir = path.join(PROJECT_ROOT, 'transcripts');
  await mkdir(outDir, { recursive: true });

  const workDir = await mkdtemp(path.join(tmpdir(), 'whisperx-'));
  const wavPath = path.join(workDir, `${baseName}.wav`);

  try {
    console.error(`Extracting audio from ${path.basename(mediaPath)}...`);
    await run('ffmpeg', ['-v', 'error', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-y', wavPath]);

    // A silent input yields "No active speech found" and an empty transcript,
    // which reads as a tool failure. BuildX camera ISOs sometimes carry a silent
    // AAC track with the real audio in a separate recorder file.
    const level = await measureLevel(wavPath);
    if (level.maxDb !== null && level.maxDb < SILENCE_DBFS) {
      throw new Error(
        `Audio is effectively silent (peak ${level.maxDb} dBFS).\n` +
        'This is usually a camera ISO whose real audio lives in a separate recorder file. ' +
        'Transcribe that file, or the exported cut, instead.'
      );
    }

    const cmdArgs = [
      wavPath,
      '--model', args.model,
      '--device', args.device,
      '--compute_type', args.computeType,
      '--vad_method', args.vad,
      '--language', args.language,
      '--output_dir', workDir,
      '--output_format', 'json',
    ];
    if (args.diarize) {
      cmdArgs.push('--diarize', '--hf_token', hfToken);
      if (Number.isFinite(args.speakers)) {
        cmdArgs.push('--min_speakers', String(args.speakers), '--max_speakers', String(args.speakers));
      } else {
        if (Number.isFinite(args.minSpeakers)) cmdArgs.push('--min_speakers', String(args.minSpeakers));
        if (Number.isFinite(args.maxSpeakers)) cmdArgs.push('--max_speakers', String(args.maxSpeakers));
      }
    }

    console.error(
      `Transcribing (${args.model}, ${args.device}/${args.computeType}, vad=${args.vad}` +
      `${args.diarize ? ', diarize' : ''})...`
    );
    const started = Date.now();
    await run(whisperxBin, cmdArgs);
    const elapsed = (Date.now() - started) / 1000;

    const produced = (await readdir(workDir)).find((f) => f.endsWith('.json'));
    if (!produced) throw new Error('WhisperX produced no JSON output.');
    const parsed = JSON.parse(await readFile(path.join(workDir, produced), 'utf8'));

    const { words, unaligned } = flattenWords(parsed);
    if (!words.length) {
      throw new Error('Transcript was empty — check the audio track has speech.');
    }

    const wordsPath = path.join(outDir, `${baseName}.words.json`);
    await writeFile(wordsPath, JSON.stringify(words, null, 2));

    const sentences = groupIntoSentences(words);
    const duration = words[words.length - 1].end;
    const speakers = [...new Set(words.map((w) => w.speaker).filter(Boolean))].sort();

    const md = [
      `# Transcript — ${path.basename(mediaPath)}`,
      '',
      `- Source: \`${mediaPath}\``,
      `- Duration: ${timecode(duration)} (${duration.toFixed(2)}s)`,
      `- Words: ${words.length} · Lines: ${sentences.length}`,
      `- Engine: WhisperX ${args.model} (${args.device}/${args.computeType}, vad=${args.vad})`,
      ...(speakers.length ? [`- Speakers: ${speakers.join(', ')}`] : []),
      ...(unaligned ? [`- Unaligned words (timing interpolated): ${unaligned}`] : []),
      `- Word-level data: \`transcripts/${baseName}.words.json\``,
      '',
      'Each line is `[start-end]` in **seconds** — feed these directly to `plan-cut.mjs --keep`.',
      '',
      ...sentences.map((s) => {
        const who = s.speaker ? `**${s.speaker}** ` : '';
        return `- \`[${s.start.toFixed(2)}-${s.end.toFixed(2)}]\` (${timecode(s.start)}) ${who}${s.text}`;
      }),
      '',
    ].join('\n');

    const mdPath = path.join(outDir, `${baseName}.md`);
    await writeFile(mdPath, md);

    if (args.keepAudio) {
      const kept = path.join(outDir, `${baseName}.16k.wav`);
      await run('cp', [wavPath, kept]);
    }

    console.log(JSON.stringify({
      ok: true,
      engine: `whisperx:${args.model}`,
      words: words.length,
      lines: sentences.length,
      speakers,
      unalignedWords: unaligned,
      audioPeakDb: level.maxDb,
      audioMeanDb: level.meanDb,
      durationSeconds: Number(duration.toFixed(2)),
      elapsedSeconds: Number(elapsed.toFixed(1)),
      readable: path.relative(PROJECT_ROOT, mdPath),
      wordLevel: path.relative(PROJECT_ROOT, wordsPath),
    }, null, 2));
  } finally {
    if (!args.keepAudio) await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
