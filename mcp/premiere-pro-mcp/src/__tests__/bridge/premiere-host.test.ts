/**
 * H6: one entry point to Premiere. The factory picks the host, tools work with
 * any host, and nothing else constructs the CEP bridge directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PremiereProBridge } from '../../bridge/index.js';
import { createPremiereHost, type PremiereHost } from '../../bridge/premiere-host.js';
import { PremiereProTools } from '../../tools/index.js';

describe('createPremiereHost', () => {
  it('returns the CEP/ExtendScript host by default', () => {
    const host = createPremiereHost({});
    expect(host).toBeInstanceOf(PremiereProBridge);
    expect(host.kind).toBe('cep');
    expect(createPremiereHost({ PREMIERE_HOST: 'ExtendScript' }).kind).toBe('cep');
  });

  it('refuses a host that does not exist yet', () => {
    expect(() => createPremiereHost({ PREMIERE_HOST: 'uxp' })).toThrow(/not available\. Supported: cep/);
  });
});

describe('a different host is a drop-in', () => {
  it('drives the tools through the interface alone', async () => {
    const scripts: string[] = [];
    const fake: PremiereHost = {
      kind: 'cep',
      initialize: async () => undefined,
      cleanup: async () => undefined,
      executeScript: async (s: string) => {
        scripts.push(s);
        return { success: true, name: 'Fake Project.prproj', id: 'p1' };
      },
      createProject: async () => ({}) as any,
      openProject: async () => ({}) as any,
      saveProject: async () => undefined,
      importMedia: async () => ({}) as any,
      createSequence: async () => ({}) as any,
      addToTimeline: async () => ({}) as any,
      addToTimelineBatch: async () => ({}),
      renderSequence: async () => ({ success: true })
    };
    const tools = new PremiereProTools(fake);
    const info = await tools.executeTool('get_project_info', {});
    expect(info).toMatchObject({ name: 'Fake Project.prproj' });
    expect(scripts.length).toBe(1);
  });
});

describe('single entry point', () => {
  it('only premiere-host.ts constructs the CEP bridge', () => {
    const src = path.resolve(process.cwd(), 'src');
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
    const offenders = walk(src)
      .filter((f) => f.endsWith('.ts') && !f.endsWith(path.join('bridge', 'premiere-host.ts')))
      .filter((f) => /new PremiereProBridge\s*\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f));
    expect(offenders).toEqual([]);
  });
});
