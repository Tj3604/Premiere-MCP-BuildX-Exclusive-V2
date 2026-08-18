#!/usr/bin/env node
/**
 * Start a project from the vertical template.
 *
 * Sequences cannot be created programmatically — `create_sequence_from_preset`,
 * `set_sequence_frame_rate` and `set_sequence_resolution` all return success and
 * do nothing. Copying a known-good template project is the only reliable way to
 * land on 1080x1920 @ 29.97 with the right track layout.
 *
 * Usage:
 *   node scripts/new-project.mjs "X0412 (Surname)" --dest "/path/to/projects"
 *   node scripts/new-project.mjs --code X0412 --surname Surname --dest <dir>
 *
 * Options:
 *   --dest <dir>    parent directory for the new project folder (required)
 *   --flat          write the .prproj directly into --dest, no project folder
 *   --force         overwrite an existing project file
 *   --no-folders    skip the standard working subfolders
 *
 * Creates:
 *   <dest>/X0412 (Surname)/
 *     X0412 (Surname).prproj
 *     footage/  transcripts/  graphics/  renders/  exports/
 */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(PROJECT_ROOT, 'presets', 'buildx-vertical-template.prproj');

// X followed by four digits, then a surname in parentheses.
const NAME_PATTERN = /^X\d{4} \([^()]+\)$/;

const SUBFOLDERS = ['footage', 'transcripts', 'graphics', 'renders', 'exports'];

function parseArgs(argv) {
  const out = { folders: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dest': out.dest = argv[++i]; break;
      case '--code': out.code = argv[++i]; break;
      case '--surname': out.surname = argv[++i]; break;
      case '--flat': out.flat = true; break;
      case '--force': out.force = true; break;
      case '--no-folders': out.folders = false; break;
      default: rest.push(argv[i]);
    }
  }
  if (!out.code || !out.surname) out.name = rest[0];
  else out.name = `${out.code} (${out.surname})`;
  return out;
}

function die(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.name) {
    die('Usage: node scripts/new-project.mjs "X0412 (Surname)" --dest <dir>');
  }
  if (!NAME_PATTERN.test(args.name)) {
    die(
      `Project name "${args.name}" does not match the convention.\n` +
      '  Expected: X#### (surname)   e.g. "X0412 (Surname)"\n' +
      '  Four digits, one space, surname in parentheses.'
    );
  }
  if (!args.dest) die('--dest <dir> is required — where should the project live?');

  if (!existsSync(TEMPLATE)) {
    die(
      `Template missing: ${path.relative(PROJECT_ROOT, TEMPLATE)}\n\n` +
      'Author it once, by hand, in Premiere:\n' +
      '  1. File > New > Project, save it as presets/buildx-vertical-template.prproj\n' +
      '  2. File > New > Sequence > Settings tab:\n' +
      '       Editing Mode:    Custom\n' +
      '       Timebase:        29.97 frames/second\n' +
      '       Frame Size:      1080 horizontal, 1920 vertical  (9:16)\n' +
      '       Pixel Aspect:    Square Pixels (1.0)\n' +
      '       Fields:          No Fields (Progressive Scan)\n' +
      '       Audio Sample Rate: 48000 Hz\n' +
      '  3. Tracks tab: 3 video tracks, 2 audio tracks (stereo)\n' +
      '       V1 footage · V2 overlays · V3 captions · A1/A2 audio\n' +
      '  4. Name the sequence, save the project, close it.\n\n' +
      'Verify it with:\n' +
      '  node scripts/check-sequence.mjs   (with the template open in Premiere)'
    );
  }

  const destRoot = path.resolve(args.dest);
  if (!existsSync(destRoot)) die(`--dest does not exist: ${destRoot}`);
  const destStat = await stat(destRoot);
  if (!destStat.isDirectory()) die(`--dest is not a directory: ${destRoot}`);

  const projectDir = args.flat ? destRoot : path.join(destRoot, args.name);
  const projectFile = path.join(projectDir, `${args.name}.prproj`);

  if (existsSync(projectFile) && !args.force) {
    die(
      `Refusing to overwrite an existing project:\n  ${projectFile}\n\n` +
      'Premiere loses its media links when the file underneath it changes. ' +
      'Pick another name, or pass --force if you are certain.'
    );
  }

  await mkdir(projectDir, { recursive: true });
  await copyFile(TEMPLATE, projectFile);

  const created = [];
  if (args.folders && !args.flat) {
    for (const f of SUBFOLDERS) {
      await mkdir(path.join(projectDir, f), { recursive: true });
      created.push(f);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    name: args.name,
    projectFile,
    projectDir,
    subfolders: created,
    nextSteps: [
      `Open ${path.basename(projectFile)} in Premiere`,
      'Start the CEP bridge panel',
      'node scripts/check-sequence.mjs   <- must pass before any build step',
    ],
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
