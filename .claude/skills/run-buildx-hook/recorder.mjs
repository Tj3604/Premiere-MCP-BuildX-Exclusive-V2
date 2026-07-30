#!/usr/bin/env node
/**
 * Usage: node recorder.mjs <html-file-basename>
 *
 * Records a buildx-hook HTML animation as a ProRes 4444 MOV with alpha channel.
 * Captures 180 frames at 30fps (6s) using Playwright animation seek + ffmpeg.
 *
 * Output: ~/Downloads/<basename>.mov
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { basename, resolve } from 'path';
import { homedir, tmpdir } from 'os';

const downloadsDir = resolve(homedir(), 'Downloads');
const [, , fileArg] = process.argv;

if (!fileArg) {
  console.error('Usage: node recorder.mjs <html-file-basename>');
  process.exit(1);
}

const htmlFile = fileArg.endsWith('.html') ? fileArg : fileArg + '.html';
const filePath = resolve(downloadsDir, htmlFile);
if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const slug = basename(htmlFile, '.html');
const outputPath = resolve(downloadsDir, `${slug}.mov`);
const framesDir = resolve(tmpdir(), `buildx-frames-${Date.now()}`);
mkdirSync(framesDir);

function serverUp() {
  try {
    execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:5500/', { encoding: 'utf8' });
    return true;
  } catch { return false; }
}

if (!serverUp()) {
  console.log('Starting http.server at localhost:5500 ...');
  const server = spawn('python3', ['-m', 'http.server', '5500'], {
    cwd: downloadsDir, detached: true, stdio: 'ignore',
  });
  server.unref();
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (serverUp()) break;
  }
}

const FPS = 30;
const DURATION_MS = 6000;
const TOTAL_FRAMES = FPS * (DURATION_MS / 1000); // 180

console.log(`Recording ${htmlFile} → ${slug}.mov`);
console.log(`${TOTAL_FRAMES} frames @ ${FPS}fps (${DURATION_MS / 1000}s)`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });

await page.goto(`http://localhost:5500/${htmlFile}`);
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
