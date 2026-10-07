/**
 * BuildX video library: entry validation, the private-dir switch, and the
 * buildx://library/* resources reading real files from a temp private dir.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  entriesDir,
  listEntries,
  readEntry,
  resolvePrivateDir,
  validateEntry,
  type VideoEntry
} from '../../library/index.js';
import { PremiereProResources } from '../../resources/index.js';
import type { PremiereProTransport } from '../../bridge/types.js';

function sampleEntry(slug: string, addedAt: string): VideoEntry {
  return {
    schemaVersion: 1,
    slug,
    title: 'Sample Short',
    hookLine: 'We started with a rectangle.',
    transcriptPath: '/tmp/sample.words.json',
    lengthSeconds: 24.5,
    cutCount: 9,
    graphicsUsed: ['thumbnail-card', 'logo', 'end-card'],
    captionStyle: 'Thomas Default',
    platformLinks: { youtube: null, instagram: null, tiktok: null, facebook: null },
    publishDate: null,
    performance: {
      views7d: null,
      views30d: 1200,
      avgViewDurationSeconds: null,
      retentionPercent: null,
      stayedToWatchPercent: 41.5,
      measuredAt: '2026-10-06'
    },
    exportPath: '/tmp/sample.mp4',
    addedAt
  };
}

const noBridge = {} as PremiereProTransport;

describe('BuildX video library', () => {
  let privateDir: string;

  beforeEach(async () => {
    privateDir = await mkdtemp(path.join(tmpdir(), 'buildx-private-'));
    await mkdir(entriesDir(privateDir), { recursive: true });
  });

  afterEach(async () => {
    await rm(privateDir, { recursive: true, force: true });
  });

  async function put(name: string, value: unknown) {
    await writeFile(path.join(entriesDir(privateDir), name), JSON.stringify(value));
  }

  it('accepts a complete entry and names every problem in a broken one', () => {
    expect(validateEntry(sampleEntry('good-one', '2026-10-06T00:00:00Z'))).toEqual([]);

    const broken = { ...sampleEntry('Bad Slug', 'x'), cutCount: 2.5, performance: { views7d: 'many' } };
    const problems = validateEntry(broken);
    expect(problems.some((p) => p.startsWith('slug'))).toBe(true);
    expect(problems.some((p) => p.startsWith('cutCount'))).toBe(true);
    expect(problems.some((p) => p.startsWith('performance.views7d'))).toBe(true);
  });

  it('prefers BUILDX_PRIVATE_DIR over the fallback', () => {
    expect(resolvePrivateDir({ BUILDX_PRIVATE_DIR: '/x/private' }, '/repo/private')).toBe('/x/private');
    expect(resolvePrivateDir({}, '/repo/private')).toBe('/repo/private');
    expect(resolvePrivateDir({ BUILDX_PRIVATE_DIR: '  ' }, '/repo/private')).toBe('/repo/private');
  });

  it('lists valid entries oldest first and reports bad files instead of throwing', async () => {
    await put('later.json', sampleEntry('later', '2026-10-06T12:00:00Z'));
    await put('earlier.json', sampleEntry('earlier', '2026-10-01T12:00:00Z'));
    await writeFile(path.join(entriesDir(privateDir), 'broken.json'), '{ not json');

    const { entries, skipped } = await listEntries(privateDir);
    expect(entries.map((e) => e.slug)).toEqual(['earlier', 'later']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatch(/^broken\.json/);
  });

  it('refuses path-traversal slugs', async () => {
    await expect(readEntry(privateDir, '../../etc/passwd')).rejects.toThrow('Invalid library slug');
  });

  it('returns an empty library when the private dir has no entries folder', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'buildx-empty-'));
    try {
      expect(await listEntries(empty)).toEqual({ entries: [], skipped: [] });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  describe('resources', () => {
    it('serves the index and a single entry from the private dir', async () => {
      await put('sample-short.json', sampleEntry('sample-short', '2026-10-06T00:00:00Z'));
      const resources = new PremiereProResources(noBridge, { privateDir });

      const index = await resources.readResource('buildx://library/index');
      expect(index.count).toBe(1);
      expect(index.entries[0]).toEqual({
        slug: 'sample-short',
        uri: 'buildx://library/entry/sample-short',
        title: 'Sample Short',
        hookLine: 'We started with a rectangle.',
        lengthSeconds: 24.5,
        publishDate: null,
        views30d: 1200,
        stayedToWatchPercent: 41.5
      });

      expect(resources.getResource('buildx://library/entry/sample-short')?.mimeType).toBe('application/json');
      const entry = await resources.readResource('buildx://library/entry/sample-short');
      expect(entry.cutCount).toBe(9);
    });

    it('reads the tracked schema from the knowledge dir', async () => {
      const knowledgeDir = path.resolve(process.cwd(), '..', '..', 'knowledge');
      const resources = new PremiereProResources(noBridge, { privateDir, knowledgeDir });
      const schema = JSON.parse(await resources.readResource('buildx://library/schema'));
      expect(schema.$id).toBe('buildx://library/schema');
      expect(schema.description).toMatch(/BUILDX_PRIVATE_DIR/);
    });

    it('says the private dir is not configured rather than guessing', async () => {
      const resources = new PremiereProResources(noBridge);
      await expect(resources.readResource('buildx://library/index')).rejects.toThrow('BUILDX_PRIVATE_DIR');
    });
  });
});
