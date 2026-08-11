#!/usr/bin/env node
/**
 * Usage: node recorder.mjs <html-file-basename>
 *
 * Records a buildx-hook HTML animation as a ProRes 4444 MOV with alpha channel.
 * Captures 180 frames at 30fps (6s) using Playwright animation seek + ffmpeg.
 *
 * The hook is located by hooks-dir.mjs (repo hooks/, $BUILDX_HOOKS_DIR, or an
 * explicit path) and that folder becomes the static server root.
 *
 * Output: <basename>.mov, written next to the hook.
 */

import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { basename, resolve } from 'path';
import { tmpdir } from 'os';
import { ensureServer, resolveHook } from './hooks-dir.mjs';

const [, , fileArg] = process.argv;

if (!fileArg) {
  console.error('Usage: node recorder.mjs <html-file-basename>');
  process.exit(1);
}

const { htmlFile, serveDir } = resolveHook(fileArg);

const slug = basename(htmlFile, '.html');
const outputPath = resolve(serveDir, `${slug}.mov`);
const framesDir = resolve(tmpdir(), `buildx-frames-${Date.now()}`);
mkdirSync(framesDir);

const FPS = 30;
const DURATION_MS = 6000;
const TOTAL_FRAMES = FPS * (DURATION_MS / 1000); // 180

console.log(`Recording ${htmlFile} → ${slug}.mov`);
console.log(`${TOTAL_FRAMES} frames @ ${FPS}fps (${DURATION_MS / 1000}s)`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });

const baseUrl = await ensureServer(serveDir, htmlFile);
await page.goto(`${baseUrl}/${encodeURIComponent(htmlFile)}`);
await page.waitForLoadState('networkidle');

// Pause all CSS animations so we can seek frame-by-frame
await page.evaluate(() => {
  document.getAnimations().forEach(a => a.pause());
});

for (let i = 0; i < TOTAL_FRAMES; i++) {
  const timeMs = (i / FPS) * 1000;

  await page.evaluate((t) => {
    document.getAnimations().forEach(a => { a.currentTime = t; });
  }, timeMs);

  const framePath = resolve(framesDir, `frame-${String(i).padStart(4, '0')}.png`);
  await page.screenshot({ path: framePath, omitBackground: true });

  if (i % 30 === 0) console.log(`  frame ${i + 1}/${TOTAL_FRAMES}`);
}

await browser.close();

console.log('Encoding ProRes 4444 with alpha...');
execSync(
  `ffmpeg -y -framerate ${FPS} -i "${framesDir}/frame-%04d.png" ` +
  `-vcodec prores_ks -profile:v 4444 -pix_fmt yuva444p10le -vendor apl0 ` +
  `"${outputPath}"`,
  { stdio: 'inherit' }
);

rmSync(framesDir, { recursive: true });

console.log(`Done: ${outputPath}`);
