#!/usr/bin/env node
/**
 * Make a new graphic from a shared template in graphics-template/.
 *
 *   node scripts/graphic-from-template.mjs --template question-card \
 *        --set question="Do you need a *permit* for an ADU?" --set eyebrow="Ask Buz" \
 *        [--format 9x16|16x9] --out graphics/q-permit
 *
 *   node scripts/graphic-from-template.mjs --list
 *
 * Copies the template (and its assets) into a NEW folder, inlines tokens.css and fills
 * the {{…}} fields. Text is HTML-escaped; *word* becomes the gold emphasis. Refuses to
 * write into a folder that already exists. Then render with scripts/render-graphic.mjs
 * (the printed command adds --alpha only for overlay templates).
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(PROJECT_ROOT, 'graphics-template');
const SIZES = { '9x16': [1080, 1920], '16x9': [1920, 1080] };

function parseArgs(argv) {
  const args = { set: {}, format: '9x16' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--template') args.template = argv[++i];
    else if (a === '--format') args.format = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--list') args.list = true;
    else if (a === '--set') {
      const kv = argv[++i] ?? '';
      const eq = kv.indexOf('=');
      if (eq < 1) throw new Error(`--set needs key=value, got "${kv}"`);
      args.set[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else throw new Error(`Unknown option ${a}`);
  }
  return args;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escaped text with *word* -> <em>word</em>. */
function richText(s) {
  return escapeHtml(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

async function listTemplates() {
  const out = [];
  for (const d of await readdir(TEMPLATES, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = path.join(TEMPLATES, d.name, 'params.json');
    if (!existsSync(p)) continue;
    const spec = JSON.parse(await readFile(p, 'utf8'));
    out.push({ template: d.name, description: spec.description, formats: spec.formats, params: spec.params });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    console.log(JSON.stringify(await listTemplates(), null, 2));
    return;
  }
  if (!args.template || !args.out) {
    console.error('Usage: node scripts/graphic-from-template.mjs --template <name> --set key=value ... [--format 9x16|16x9] --out graphics/<new-folder>');
    console.error('       node scripts/graphic-from-template.mjs --list');
    process.exit(2);
  }
  const dir = path.join(TEMPLATES, args.template);
  const specPath = path.join(dir, 'params.json');
  if (!existsSync(specPath)) throw new Error(`No template "${args.template}" in graphics-template/ (try --list)`);
  const spec = JSON.parse(await readFile(specPath, 'utf8'));
  if (!spec.formats.includes(args.format)) throw new Error(`"${args.template}" supports ${spec.formats.join(', ')}, not ${args.format}`);

  const unknown = Object.keys(args.set).filter((k) => !(k in spec.params));
  if (unknown.length) throw new Error(`Unknown field(s) ${unknown.join(', ')}. "${args.template}" takes: ${Object.keys(spec.params).join(', ')}`);
  const values = {};
  for (const [key, p] of Object.entries(spec.params)) {
    const v = args.set[key] ?? p.default;
    if (v === undefined || (p.required && !String(v).trim())) throw new Error(`"${key}" is required — ${p.help ?? ''} e.g. ${p.example ?? ''}`);
    values[key] = v;
  }
  if ('duration' in values && !(Number(values.duration) > 0)) throw new Error(`duration must be a positive number of seconds, got "${values.duration}"`);

  const out = path.resolve(PROJECT_ROOT, args.out);
  if (existsSync(out)) throw new Error(`${args.out} already exists — pick a new folder name; existing graphics are never overwritten.`);

  const [width, height] = SIZES[args.format];
  const fields = { ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, k === 'duration' ? String(Number(v)) : richText(v)])), width, height, format: args.format };
  const tokens = await readFile(path.join(TEMPLATES, 'tokens.css'), 'utf8');
  let html = (await readFile(path.join(dir, 'index.html'), 'utf8')).replace('/*TOKENS*/', tokens);
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fields ? String(fields[k]) : m));
  const left = html.match(/\{\{\w+\}\}/g);
  if (left) throw new Error(`Template left unfilled: ${[...new Set(left)].join(', ')}`);

  await mkdir(out, { recursive: true });
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'index.html' || entry.name === 'params.json') continue;
    await cp(path.join(dir, entry.name), path.join(out, entry.name), { recursive: true });
  }
  await writeFile(path.join(out, 'index.html'), html);
  await writeFile(
    path.join(out, 'template.json'),
    JSON.stringify({ template: args.template, format: args.format, values, createdAt: new Date().toISOString() }, null, 2) + '\n'
  );

  const name = path.basename(out);
  console.log(
    JSON.stringify(
      {
        ok: true,
        out,
        template: args.template,
        format: args.format,
        size: `${width}x${height}`,
        render: `node scripts/render-graphic.mjs ${path.relative(PROJECT_ROOT, out)}${spec.alpha ? ' --alpha' : ''} --fps 30000/1001 --name ${name}`
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`graphic-from-template: ${error.message}`);
  process.exit(1);
});
