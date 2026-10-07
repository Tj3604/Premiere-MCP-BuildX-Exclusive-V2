// node --test scripts/__tests__   (also run by `npm test` at the repo root)
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findTool, MissingToolError, renderReport, requireTools, runChecks } from '../doctor.mjs';

function fakeBin(names) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bx-doctor-'));
  for (const n of names) {
    const f = path.join(dir, n);
    writeFileSync(f, '#!/bin/sh\n');
    chmodSync(f, 0o755);
  }
  return dir;
}

test('requireTools returns paths when everything is there', () => {
  const dir = fakeBin(['ffmpeg', 'ffprobe']);
  const found = requireTools(['ffmpeg', 'ffprobe'], {}, [dir]);
  assert.equal(found.ffmpeg, path.join(dir, 'ffmpeg'));
});

test('requireTools throws a readable install hint instead of ENOENT', () => {
  const dir = fakeBin(['ffprobe']);
  assert.throws(
    () => requireTools(['ffmpeg', 'verthor', 'ffprobe'], {}, [dir]),
    (e) => {
      assert.ok(e instanceof MissingToolError);
      assert.deepEqual(e.missing, ['ffmpeg', 'verthor']);
      assert.match(e.message, /ffmpeg is not installed — brew install ffmpeg/);
      assert.match(e.message, /verthor is not installed — uv tool install verthor/);
      assert.match(e.message, /npm run doctor/);
      return true;
    }
  );
});

test('findTool searches the given folders in order', () => {
  const a = fakeBin([]);
  const b = fakeBin(['scenedetect']);
  assert.equal(findTool('scenedetect', {}, [a, b]), path.join(b, 'scenedetect'));
  assert.equal(findTool('nope', {}, [a, b]), null);
});

test('runChecks reports exactly what is missing, with fixes; optional items never fail', () => {
  const bin = fakeBin(['ffmpeg', 'ffprobe', 'whisperx', 'scenedetect', 'verthor', 'deepFilter']);
  const home = mkdtempSync(path.join(tmpdir(), 'bx-home-'));
  const root = mkdtempSync(path.join(tmpdir(), 'bx-root-'));
  const rows = runChecks({}, root, [bin], home);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.ffmpeg.ok, true);
  assert.equal(byName['whisperx-pyannote'].level, 'optional');
  assert.equal(byName['playwright (Chromium)'].ok, false);
  assert.match(byName['playwright (Chromium)'].fix, /npx playwright install chromium/);
  assert.equal(byName.HF_TOKEN.level, 'optional');
  assert.equal(byName['presets/buildx-vertical-template.prproj'].ok, false);
  assert.match(byName['presets/buildx-vertical-template.prproj'].fix, /File > New > Project/);
  const text = renderReport(rows);
  assert.match(text, /2 missing: playwright \(Chromium\), presets\/buildx-vertical-template.prproj/);

  // With the browsers and the template present, nothing required is missing.
  mkdirSync(path.join(home, 'Library', 'Caches', 'ms-playwright', 'chromium-1228'), { recursive: true });
  mkdirSync(path.join(root, 'presets'));
  writeFileSync(path.join(root, 'presets', 'buildx-vertical-template.prproj'), 'x');
  assert.match(renderReport(runChecks({ HF_TOKEN: 'hf_x' }, root, [bin], home)), /Everything required is installed/);
});
