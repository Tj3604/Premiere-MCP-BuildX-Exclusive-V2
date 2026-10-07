/**
 * knowledge/INDEX.md must list every tracked knowledge file, and every tracked URI
 * it lists must open through the resources layer.
 */

import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  KNOWLEDGE_FILE_URI_PREFIX,
  PremiereProResources,
  resolveKnowledgePath
} from '../../resources/index.js';

// Jest runs from mcp/premiere-pro-mcp.
const KNOWLEDGE_DIR = path.resolve(process.cwd(), '..', '..', 'knowledge');

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...(await walk(full, base)));
    else if (/\.(md|json)$/i.test(d.name)) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

describe('knowledge index', () => {
  let index: string;
  const resources = () => new PremiereProResources({} as any, { knowledgeDir: KNOWLEDGE_DIR });

  beforeAll(async () => {
    index = await readFile(path.join(KNOWLEDGE_DIR, 'INDEX.md'), 'utf8');
  });

  it('opens with a one-line description', () => {
    expect(index.split('\n')[0]).toMatch(/^> \S/);
  });

  it('lists every tracked knowledge file', async () => {
    const files = (await walk(KNOWLEDGE_DIR)).filter((f) => f !== 'INDEX.md');
    const missing = files.filter(
      (f) => !index.includes(`${KNOWLEDGE_FILE_URI_PREFIX}${f}`) && !(f.endsWith('.schema.json') && index.includes(f))
    );
    expect(missing).toEqual([]);
  });

  it('every tracked URI it lists opens', async () => {
    const uris = [...index.matchAll(/`(buildx:\/\/knowledge\/file\/[^`]+)`/g)].map((m) => m[1]!);
    expect(uris.length).toBeGreaterThan(10);
    const r = resources();
    for (const uri of uris) {
      const text = await r.readResource(uri);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    }
    expect(await r.readResource('buildx://knowledge/index')).toBe(index);
  });

  it('refuses paths outside the knowledge dir and non-text files', () => {
    expect(() => resolveKnowledgePath(KNOWLEDGE_DIR, '../CLAUDE.md')).toThrow(/outside/);
    expect(() => resolveKnowledgePath(KNOWLEDGE_DIR, '%2E%2E/private/x.md')).toThrow(/outside/);
    expect(() => resolveKnowledgePath(KNOWLEDGE_DIR, '/etc/hosts.md')).toThrow(/outside/);
    expect(() => resolveKnowledgePath(KNOWLEDGE_DIR, 'buildx/.DS_Store')).toThrow(/\.md or \.json/);
  });

  it('reads private knowledge from the private dir and says so when it is absent', async () => {
    const privateDir = await mkdtemp(path.join(os.tmpdir(), 'bx-private-'));
    await mkdir(path.join(privateDir, 'knowledge'));
    await writeFile(path.join(privateDir, 'knowledge', 'notes.md'), '> Test notes.\n');
    const r = new PremiereProResources({} as any, { knowledgeDir: KNOWLEDGE_DIR, privateDir });
    expect(await r.readResource('buildx://private/knowledge/notes.md')).toBe('> Test notes.\n');
    await expect(r.readResource('buildx://private/knowledge/gone.md')).rejects.toThrow(/BUILDX_PRIVATE_DIR/);
    expect(r.getResource('buildx://private/knowledge/notes.md')?.mimeType).toBe('text/markdown');
  });
});
