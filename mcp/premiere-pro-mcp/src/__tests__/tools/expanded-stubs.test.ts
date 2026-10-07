/**
 * Honest stubs: an expanded tool with no Premiere implementation must fail with
 * "not implemented", never answer success with a canned note.
 */

import { executeExpandedTool } from '../../tools/expanded.js';

function capture() {
  const scripts: string[] = [];
  const bridge = { executeScript: jest.fn(async (s: string) => { scripts.push(s); return { success: false }; }) } as any;
  return { bridge, scripts };
}

describe('expanded tool stubs', () => {
  it('no longer contains a success-returning catch-all or canned read note', async () => {
    const { bridge, scripts } = capture();
    await executeExpandedTool(bridge, 'delete_project_item', { nodeId: 'x' });
    const script = scripts[0]!;
    expect(script).not.toMatch(/accepted: true/);
    expect(script).not.toMatch(/Read operation completed/);
    // Both the default case and the old canned-read case now fail.
    expect(script.match(/fail\("not implemented: " \+ toolName/g)?.length).toBe(2);
  });

  it('still dispatches implemented tools to their own case', async () => {
    const { bridge, scripts } = capture();
    await executeExpandedTool(bridge, 'rename_clip', { clipId: 'c', newName: 'n' });
    expect(scripts[0]).toMatch(/case "rename_clip":/);
  });
});
