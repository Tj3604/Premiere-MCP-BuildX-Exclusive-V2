/**
 * H3: raw scripts off by default, user input reaches ExtendScript only as JSON
 * string literals, and path traversal is caught before normalisation.
 */

import { PremiereProBridge } from '../../bridge/index.js';
import { executeExpandedTool, rawScriptsAllowed } from '../../tools/expanded.js';
import { PremiereProTools } from '../../tools/index.js';
import { validateFilePath } from '../../utils/security.js';

const EVIL = 'x"); evil(); ("';
const ESCAPED = JSON.stringify(EVIL).slice(1, -1); // x\"); evil(); (\"

describe('validateFilePath', () => {
  it('rejects ".." segments before normalising folds them away', () => {
    expect(validateFilePath('/Users/me/exports/../../../etc/passwd').valid).toBe(false);
    expect(validateFilePath('/tmp/a/../b.mp4')).toMatchObject({ valid: false, error: 'Path traversal detected' });
    expect(validateFilePath('..\\windows\\x').valid).toBe(false);
  });

  it('allows names that merely contain two dots', () => {
    expect(validateFilePath('/tmp/Short 01..final.mp4').valid).toBe(true);
  });

  it('still blocks system directories', () => {
    expect(validateFilePath('/etc/hosts').valid).toBe(false);
  });
});

describe('execute_extendscript', () => {
  const saved = process.env.PREMIERE_MCP_ALLOW_RAW_SCRIPTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.PREMIERE_MCP_ALLOW_RAW_SCRIPTS;
    else process.env.PREMIERE_MCP_ALLOW_RAW_SCRIPTS = saved;
  });

  it('is off unless PREMIERE_MCP_ALLOW_RAW_SCRIPTS is set', async () => {
    expect(rawScriptsAllowed({})).toBe(false);
    expect(rawScriptsAllowed({ PREMIERE_MCP_ALLOW_RAW_SCRIPTS: '1' })).toBe(true);
    expect(rawScriptsAllowed({ PREMIERE_MCP_ALLOW_RAW_SCRIPTS: 'true' })).toBe(true);
    expect(rawScriptsAllowed({ PREMIERE_MCP_ALLOW_RAW_SCRIPTS: '0' })).toBe(false);

    const bridge = { executeScript: jest.fn(async () => ({ success: true })) } as any;
    delete process.env.PREMIERE_MCP_ALLOW_RAW_SCRIPTS;
    const refused = await executeExpandedTool(bridge, 'execute_extendscript', { script: 'app.quit()' });
    expect(refused).toMatchObject({ success: false });
    expect(refused.error).toMatch(/PREMIERE_MCP_ALLOW_RAW_SCRIPTS=1/);
    expect(bridge.executeScript).not.toHaveBeenCalled();

    process.env.PREMIERE_MCP_ALLOW_RAW_SCRIPTS = '1';
    await executeExpandedTool(bridge, 'execute_extendscript', { script: 'return 1;' });
    expect(bridge.executeScript).toHaveBeenCalledWith('return 1;');
  });
});

describe('ExtendScript escaping', () => {
  it('passes hostile strings into tool scripts only as JSON literals', async () => {
    const scripts: string[] = [];
    const bridge = { executeScript: jest.fn(async (s: string) => { scripts.push(s); return { success: false, error: 'stub' }; }) } as any;
    const tools = new PremiereProTools(bridge);
    const calls: Array<[string, Record<string, unknown>]> = [
      ['delete_sequence', { sequenceId: EVIL }],
      ['apply_effect', { clipId: EVIL, effectName: EVIL }],
      ['add_transition', { clipId1: EVIL, clipId2: EVIL, transitionName: EVIL, duration: 1 }],
      ['create_bin', { name: EVIL, parentBinName: EVIL }],
      ['save_project_as', { name: EVIL, location: '/tmp' }],
      ['apply_lut', { clipId: EVIL, lutPath: `/tmp/${EVIL}.cube` }],
      ['import_fcp_xml', { filePath: `/tmp/${EVIL}.xml` }]
    ];
    for (const [name, args] of calls) await tools.executeTool(name, args as Record<string, any>);
    expect(scripts.length).toBeGreaterThanOrEqual(calls.length);
    for (const s of scripts) {
      expect(s.replace(new RegExp(ESCAPED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')).not.toContain('evil()');
      expect(s).toContain(ESCAPED);
    }
  });

  it('does the same in the bridge scripts', async () => {
    const bridge = new PremiereProBridge();
    const scripts: string[] = [];
    jest.spyOn(bridge, 'executeScript').mockImplementation(async (s: string) => {
      scripts.push(s);
      return { success: false };
    });
    await bridge.renderSequence(EVIL, `/tmp/${EVIL}.mp4`, `/tmp/${EVIL}.epr`).catch(() => undefined);
    await bridge.addToTimeline(EVIL, EVIL, 0, 0).catch(() => undefined);
    expect(scripts.length).toBe(2);
    for (const s of scripts) {
      expect(s.replace(new RegExp(ESCAPED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')).not.toContain('evil()');
    }
  });
});
