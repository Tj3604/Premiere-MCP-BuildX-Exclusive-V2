#!/usr/bin/env node
/**
 * Transcribe raw footage to word-level timestamps.
 *
 * Produces two files in transcripts/:
 *   <name>.words.json  — raw [{text,start,end}] array, fed to plan-cut.mjs
 *   <name>.md          — sentence-grouped, timecoded, readable. Read THIS to pick cuts.
 *
 * Usage:
 *   node scripts/transcribe.mjs <media-file> [--model small.en]
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A new sentence starts after terminal punctuation, or after a pause this long.
// 0.6s reliably separates spoken sentences without splitting mid-thought.
const PAUSE_SPLIT_SECONDS = 0.6;

function parseArgs(argv) {
  const args = { model: 'small.en' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') args.model = argv[++i];
    else rest.push(argv[i]);
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

function timecode(seconds) {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Group a flat word list into sentence-ish lines with start/end times. */
function groupIntoSentences(words) {
  const sentences = [];
  let current = null;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!current) {
      current = { start: word.start, end: word.end, words: [] };
    }
    current.words.push(word.text);
    current.end = word.end;

    const endsSentence = /[.!?]"?$/.test(word.text);
    const next = words[i + 1];
    const pauseAfter = next ? next.start - word.end : Infinity;

    if (endsSentence || pauseAfter >= PAUSE_SPLIT_SECONDS || !next) {
      current.text = current.words.join(' ');
      sentences.push(current);
      current = null;
    }
  }
  return sentences;
}

async function main() {
  const { input, model } = parseArgs(process.argv.slice(2));

  if (!input) {
    console.error('Usage: node scripts/transcribe.mjs <media-file> [--model small.en]');
    process.exit(1);
  }

  const mediaPath = path.resolve(input);
  if (!existsSync(mediaPath)) {
    console.error(`Media file not found: ${mediaPath}`);
    process.exit(1);
  }

  const baseName = path.basename(mediaPath, path.extname(mediaPath));
  const outDir = path.join(PROJECT_ROOT, 'transcripts');
  await mkdir(outDir, { recursive: true });

  // hyperframes writes transcript.json into its project dir, so give it a scratch
  // dir of its own rather than letting it drop files next to the source media.
  const workDir = await mkdtemp(path.join(tmpdir(), 'hf-transcribe-'));

  console.error(`Transcribing ${path.basename(mediaPath)} (model: ${model})...`);
  try {
    await run('npx', ['--yes', 'hyperframes@latest', 'transcribe', mediaPath, '-d', workDir, '--model', model, '--json']);

    const raw = await readFile(path.join(workDir, 'transcript.json'), 'utf8');
    const words = JSON.parse(raw);

    if (!Array.isArray(words) || words.length === 0) {
      throw new Error('Transcript was empty — does this file have an audio track?');
    }

    const wordsPath = path.join(outDir, `${baseName}.words.json`);
    await writeFile(wordsPath, JSON.stringify(words, null, 2));

    const sentences = groupIntoSentences(words);
    const duration = words[words.length - 1].end;

    const md = [
      `# Transcript — ${path.basename(mediaPath)}`,
      '',
      `- Source: \`${mediaPath}\``,
      `- Duration: ${timecode(duration)} (${duration.toFixed(2)}s)`,
      `- Words: ${words.length} · Lines: ${sentences.length}`,
      `- Word-level data: \`transcripts/${baseName}.words.json\``,
      '',
      'Each line is `[start-end]` in **seconds** — feed these directly to `plan-cut.mjs --keep`.',
      '',
      ...sentences.map(
        (s) => `- \`[${s.start.toFixed(2)}-${s.end.toFixed(2)}]\` (${timecode(s.start)}) ${s.text}`
      ),
      '',
    ].join('\n');

    const mdPath = path.join(outDir, `${baseName}.md`);
    await writeFile(mdPath, md);

    console.log(JSON.stringify({
      ok: true,
      words: words.length,
      lines: sentences.length,
      durationSeconds: Number(duration.toFixed(2)),
      readable: path.relative(PROJECT_ROOT, mdPath),
      wordLevel: path.relative(PROJECT_ROOT, wordsPath),
    }, null, 2));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
