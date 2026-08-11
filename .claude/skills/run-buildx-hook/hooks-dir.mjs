/**
 * Locates a buildx-hook HTML file without hardcoding anyone's home directory.
 *
 * Resolution order for a bare basename:
 *   1. $BUILDX_HOOKS_DIR            — explicit override, wins over everything
 *   2. <repo>/hooks/                — templates that ship with the repo
 *   3. ~/Downloads/TM Hooks/        — the local working library
 *   4. ~/Downloads/                 — where this skill originally looked
 *
 * A path argument (anything containing a separator, absolute or relative) is
 * used as-is and skips the search entirely.
 *
 * The directory the file is found in becomes the static server root, so the
 * hook can reference sibling assets the same way it does on disk.
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, isAbsolute, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
// .claude/skills/run-buildx-hook → repo root
export const REPO_ROOT = resolve(SKILL_DIR, '..', '..', '..');

export function searchDirs() {
  return [
    process.env.BUILDX_HOOKS_DIR,
    resolve(REPO_ROOT, 'hooks'),
    resolve(homedir(), 'Downloads', 'TM Hooks'),
    resolve(homedir(), 'Downloads'),
  ].filter(Boolean);
}

/**
 * @param {string} fileArg basename or path, with or without the .html extension
 * @returns {{ filePath: string, htmlFile: string, serveDir: string }}
 */
export function resolveHook(fileArg) {
  const htmlFile = fileArg.endsWith('.html') ? fileArg : `${fileArg}.html`;

  // An explicit path wins — no searching.
  if (htmlFile.includes(sep) || isAbsolute(htmlFile)) {
    const filePath = resolve(process.cwd(), htmlFile);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    return { filePath, htmlFile: basenameOf(filePath), serveDir: dirname(filePath) };
  }

  const dirs = searchDirs();
  for (const dir of dirs) {
    const filePath = resolve(dir, htmlFile);
    if (existsSync(filePath)) {
      return { filePath, htmlFile, serveDir: dir };
    }
  }

  console.error(`Hook not found: ${htmlFile}`);
  console.error('Looked in:');
  for (const dir of dirs) console.error(`  ${dir}`);
  console.error('');
  console.error('Pass a full path, or set BUILDX_HOOKS_DIR to the folder holding your hooks.');
  process.exit(1);
}

function basenameOf(p) {
  return p.split(sep).pop();
}

/**
 * Serves `serveDir` and returns the base URL for it.
 *
 * A server already listening on the port is only reused if it actually serves
 * the file we want — otherwise it belongs to a different folder (VS Code Live
 * Server, or a previous run against another hooks directory) and would answer
 * 404, which reaches the screenshot as a blank frame rather than an error.
 * In that case we start our own server on the next free port.
 */
export async function ensureServer(serveDir, htmlFile, preferredPort = 5500) {
  const encoded = encodeURIComponent(htmlFile);

  if (httpStatus(`http://localhost:${preferredPort}/${encoded}`) === '200') {
    return `http://localhost:${preferredPort}`;
  }

  for (let port = preferredPort; port < preferredPort + 10; port++) {
    if (portInUse(port)) continue;

    console.log(`Starting http.server at localhost:${port} (serving ${serveDir}) ...`);
    const server = spawn('python3', ['-m', 'http.server', String(port)], {
      cwd: serveDir,
      detached: true,
      stdio: 'ignore',
    });
    server.unref();

    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (httpStatus(`http://localhost:${port}/${encoded}`) === '200') {
        console.log('Server up.');
        return `http://localhost:${port}`;
      }
    }
    console.error(`Server on port ${port} did not serve ${htmlFile} in time`);
    process.exit(1);
  }

  console.error(`No free port in ${preferredPort}-${preferredPort + 9}, and none of them serve ${htmlFile}.`);
  console.error(`Check what is holding them: lsof -ti :${preferredPort}`);
  process.exit(1);
}

function httpStatus(url) {
  try {
    return execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}"`, {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null; // nothing listening
  }
}

function portInUse(port) {
  return httpStatus(`http://localhost:${port}/`) !== null;
}
