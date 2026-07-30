#!/usr/bin/env node
/**
 * Usage: node driver.mjs <html-file-basename> [time_ms=3500]
 *
 * Screenshots a buildx-hook HTML file served at localhost:5500.
 * If the server is not running, starts python3 -m http.server 5500 in ~/Downloads.
 *
 * Output: ~/Downloads/<basename>-preview.png
 *
 * Examples:
 *   node driver.mjs buildx-hook-template.html
 *   node driver.mjs buildx-hook-adu-test.html 2000
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { basename, resolve } from 'path';
import { homedir } from 'os';

const downloadsDir = resolve(homedir(), 'Downloads');
const [, , fileArg, timeArg] = process.argv;

if (!fileArg) {
  console.error('Usage: node driver.mjs <html-file-basename> [time_ms=3500]');
  process.exit(1);
}

const htmlFile = fileArg.endsWith('.html') ? fileArg : fileArg + '.html';
const filePath = resolve(downloadsDir, htmlFile);

if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const timeMs = parseInt(timeArg ?? '3500', 10);
const slug = basename(htmlFile, '.html');
const outputPath = resolve(downloadsDir, `${slug}-preview.png`);

// Ensure server is running at :5500
function serverUp() {
  try {
    execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:5500/', { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

if (!serverUp()) {
  console.log('Starting http.server at localhost:5500 ...');
  const server = spawn('python3', ['-m', 'http.server', '5500'], {
    cwd: downloadsDir,
    detached: true,
    stdio: 'ignore',
  });
  server.unref();
  // Wait up to 3s for it to come up
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (serverUp()) break;
  }
  if (!serverUp()) {
    console.error('Server did not start in time');
    process.exit(1);
  }
  console.log('Server up.');
}

const url = `http://localhost:5500/${htmlFile}`;
console.log(`Screenshotting ${url} at t=${timeMs}ms → ${outputPath}`);

execSync(
  `npx playwright screenshot --wait-for-timeout ${timeMs} --viewport-size "600,1067" "${url}" "${outputPath}"`,
  { stdio: 'inherit' }
);

console.log(`Done: ${outputPath}`);
