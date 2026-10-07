#!/usr/bin/env node
/**
 * Setup check: what the scripts and tools need, what is missing, how to install it.
 *
 *   node scripts/doctor.mjs        (or: npm run doctor)
 *
 * Exits 1 if anything needed is missing. HF_TOKEN and BUILDX_TIME_LOG_DIR are
 * optional and only reported. The MCP server's own install check (CEP panel,
 * client config) is `npm run setup:doctor` in mcp/premiere-pro-mcp.
 *
 * Scripts import requireTools() from here so a missing tool produces this advice
 * instead of a raw spawn ENOENT.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where tools are looked for: PATH, then the uv tools and Homebrew folders. */
export function searchDirs(env = process.env) {
  const fromPath = String(env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return [...new Set([...fromPath, path.join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'])];
}

export function findTool(name, env = process.env, dirs = searchDirs(env)) {
  for (const dir of dirs) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export const TOOLS = {
  ffmpeg: { usedBy: 'loudness, platform versions, b-roll frames, captions checks, transcription audio', install: 'brew install ffmpeg' },
  ffprobe: { usedBy: 'every script that measures media (comes with ffmpeg)', install: 'brew install ffmpeg' },
  whisperx: { usedBy: 'scripts/transcribe-x.mjs (all transcription)', install: 'uv tool install whisperx' },
  'whisperx-pyannote': { usedBy: 'scripts/transcribe-x.mjs --diarize (speaker labels)', install: 'the whisperx-pyannote wrapper — see reference_whisperx_setup / SETUP.md' },
  scenedetect: { usedBy: 'scripts/detect-scenes.mjs, cut counts, cover frames (its OpenCV)', install: 'uv tool install "scenedetect[opencv]"' },
  verthor: { usedBy: 'scripts/reframe-vertical.mjs', install: 'uv tool install verthor   (KazKozDev/auto-vertical-reframe)' },
  deepFilter: { usedBy: 'scripts/prep-audio.mjs --force-denoise / --auto-denoise', install: 'uv tool install deepfilternet' }
};

export class MissingToolError extends Error {
  constructor(missing) {
    super(
      missing.map((n) => `${n} is not installed — ${TOOLS[n]?.install ?? 'install it'}`).join('\n') +
        '\nRun `npm run doctor` for a full setup check.'
    );
    this.name = 'MissingToolError';
    this.missing = missing;
  }
}

/** Throws MissingToolError (a readable message) if any of these tools is missing. Returns their paths. */
export function requireTools(names, env = process.env, dirs = searchDirs(env)) {
  const found = Object.fromEntries(names.map((n) => [n, findTool(n, env, dirs)]));
  const missing = names.filter((n) => !found[n]);
  if (missing.length) throw new MissingToolError(missing);
  return found;
}

function readDotEnv() {
  try {
    const text = readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8');
    return Object.fromEntries(text.split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  } catch {
    return {};
  }
}

/** Every check, as rows of { name, ok, level ('required'|'optional'|'info'), detail, fix }. */
export function runChecks(env = process.env, root = PROJECT_ROOT, dirs = searchDirs(env), home = homedir()) {
  const rows = [];
  for (const [name, t] of Object.entries(TOOLS)) {
    const p = findTool(name, env, dirs);
    const optional = name === 'whisperx-pyannote';
    rows.push({ name, ok: !!p, level: optional ? 'optional' : 'required', detail: p ?? `needed by ${t.usedBy}`, fix: p ? '' : t.install });
  }

  const pwCache = path.join(home, 'Library', 'Caches', 'ms-playwright');
  const browsers = existsSync(pwCache) ? readdirSync(pwCache).filter((d) => /^chromium/.test(d)) : [];
  rows.push({
    name: 'playwright (Chromium)',
    ok: browsers.length > 0,
    level: 'required',
    detail: browsers.length ? `${pwCache} (${browsers.join(', ')})` : 'needed to render HTML graphics (HyperFrames / hook renderer)',
    fix: browsers.length ? '' : 'npx playwright install chromium'
  });

  const hf = env.HF_TOKEN || readDotEnv().HF_TOKEN;
  rows.push({
    name: 'HF_TOKEN',
    ok: !!hf,
    level: 'optional',
    detail: hf ? 'set' : 'only needed for speaker labels (transcribe-x --diarize)',
    fix: hf ? '' : 'create a read token at huggingface.co/settings/tokens, accept the pyannote model terms, put HF_TOKEN=hf_… in .env'
  });

  const logDir = env.BUILDX_TIME_LOG_DIR?.trim() || path.join(home, 'Claude Video Editor', 'time-logs');
  rows.push({
    name: 'BUILDX_TIME_LOG_DIR',
    ok: true,
    level: 'info',
    detail: `${env.BUILDX_TIME_LOG_DIR ? 'set' : 'default'}: ${logDir}${existsSync(logDir) ? '' : ' (created on first write)'}`,
    fix: ''
  });

  const template = path.join(root, 'presets', 'buildx-vertical-template.prproj');
  rows.push({
    name: 'presets/buildx-vertical-template.prproj',
    ok: existsSync(template),
    level: 'required',
    detail: existsSync(template) ? template : 'needed by scripts/new-project.mjs',
    fix: existsSync(template)
      ? ''
      : 'in Premiere: File > New > Project, add a 1080x1920 29.97 sequence (logo on V3), then File > Save As presets/buildx-vertical-template.prproj — or copy a known-good BuildX project there'
  });
  return rows;
}

export function renderReport(rows) {
  const lines = ['BuildX setup check', ''];
  for (const r of rows) {
    const mark = r.ok ? '✓' : r.level === 'optional' ? '–' : '✗';
    lines.push(`${mark} ${r.name.padEnd(42)} ${r.detail}`);
    if (!r.ok && r.fix) lines.push(`    fix: ${r.fix}`);
  }
  const missing = rows.filter((r) => !r.ok && r.level === 'required');
  lines.push('', missing.length ? `${missing.length} missing: ${missing.map((r) => r.name).join(', ')}` : 'Everything required is installed.');
  return lines.join('\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const rows = runChecks();
  console.log(renderReport(rows));
  process.exit(rows.some((r) => !r.ok && r.level === 'required') ? 1 : 0);
}
