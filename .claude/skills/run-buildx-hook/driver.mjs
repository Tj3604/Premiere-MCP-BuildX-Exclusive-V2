#!/usr/bin/env node
/**
 * Usage: node driver.mjs <html-file-basename> [time_ms=3500]
 *
 * Screenshots a buildx-hook HTML file served at localhost:5500.
 *
 * The hook is located by hooks-dir.mjs (repo hooks/, $BUILDX_HOOKS_DIR, or an
 * explicit path) and that folder becomes the static server root.
 *
 * Output: <basename>-preview.png, written next to the hook.
 *
 * Examples:
 *   node driver.mjs buildx-hook-template.html
 *   node driver.mjs buildx-hook-adu-test.html 2000
 */

import { execSync } from 'child_process';
import { basename, resolve } from 'path';
import { ensureServer, resolveHook } from './hooks-dir.mjs';

const [, , fileArg, timeArg] = process.argv;

if (!fileArg) {
  console.error('Usage: node driver.mjs <html-file-basename> [time_ms=3500]');
  process.exit(1);
}

const { htmlFile, serveDir } = resolveHook(fileArg);

const timeMs = parseInt(timeArg ?? '3500', 10);
const slug = basename(htmlFile, '.html');
const outputPath = resolve(serveDir, `${slug}-preview.png`);

// Hooks are authored on a fixed 1080x1920 canvas, so the preview must match it.
// A smaller viewport crops the frame and silently hides copy that runs wide —
// which is the exact thing these screenshots exist to catch.
const viewport = process.env.BUILDX_HOOK_VIEWPORT ?? '1080,1920';

const baseUrl = await ensureServer(serveDir, htmlFile);
const url = `${baseUrl}/${encodeURIComponent(htmlFile)}`;
console.log(`Screenshotting ${url} at t=${timeMs}ms → ${outputPath}`);

execSync(
  `npx playwright screenshot --wait-for-timeout ${timeMs} --viewport-size "${viewport}" "${url}" "${outputPath}"`,
  { stdio: 'inherit' }
);

console.log(`Done: ${outputPath}`);
