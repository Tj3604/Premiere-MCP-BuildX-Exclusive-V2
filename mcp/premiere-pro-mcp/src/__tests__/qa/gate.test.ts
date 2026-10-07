/**
 * Export gate against a fake tool caller: blocks on QA and safe-zone failures,
 * needs a reason to override and records it, renders and checks the file.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeGateTool, qaBlockers, runGate } from '../../qa/gate.js';

jest.mock('../../audio/loudness.js', () => ({
  DEFAULT_TARGET: { lufs: -14, truePeak: -1, lra: 11 },
  measureLoudness: jest.fn(async () => ({ integratedLufs: -14.1, truePeakDbtp: -1.5, lra: 5, threshold: -24, offset: 0 }))
}));

const pass = { success: true, finalStatus: 'READY_FOR_REVIEW', finalScore: { percent: 100 }, data: { blockingItems: [], technical: [] } };
const blocked = {
  success: true,
  finalStatus: 'BLOCKED',
  finalScore: { percent: 75 },
  data: { blockingItems: [{ code: 'end_card_missing', message: 'No end card' }], technical: [{ checkId: 'timeline_gaps', status: 'AUTO_FIX', issues: [{ message: 'Gap of 1 frame' }] }] }
};
const zonesOk = { success: true, pass: 1, warn: 0, fail: 0, items: [{ name: 'V3 logo', verdict: 'pass' }] };
const zonesBad = { success: true, pass: 0, warn: 0, fail: 1, items: [{ name: 'V3 logo', verdict: 'fail', zones: { reels: ['Reels header (above y247)'] } }] };

function caller(qa: any, zones: any, out: string) {
  const calls: Array<[string, any]> = [];
  const fn = jest.fn(async (name: string, args: any) => {
    calls.push([name, args]);
    if (name === 'run_technical_qa') return args.exportPath ? { ...pass, data: { ...pass.data, technical: [{ checkId: 'export_black_frames', status: 'PASS' }] } } : qa;
    if (name === 'check_safe_zones') return zones;
    if (name === 'export_sequence') { writeFileSync(out, 'x'); return { success: true }; }
    if (name === 'record_qa_check') return { success: true };
    return { success: false, error: `unexpected ${name}` };
  });
  return { fn, calls };
}

describe('qaBlockers', () => {
  it('lists blocking items and pending auto-fixes, nothing when QA passed', () => {
    expect(qaBlockers(blocked)).toEqual(['end_card_missing: No end card', 'timeline_gaps: Gap of 1 frame — auto-fixable: run apply_safe_qa_fixes']);
    expect(qaBlockers(pass)).toEqual([]);
  });
});

describe('runGate', () => {
  const out = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'bx-gate-')), 'short.mp4');

  it('blocks and renders nothing when QA or safe zones fail', async () => {
    const o = out();
    const { fn, calls } = caller(blocked, zonesBad, o);
    const r = await runGate({ sequenceId: 's', outputPath: o }, fn);
    expect(r.status).toBe('BLOCKED');
    expect(r.blockers.join(' | ')).toMatch(/end_card_missing.*Reels header/s);
    expect(calls.map((c) => c[0])).not.toContain('export_sequence');
  });

  it('refuses an override without a reason', async () => {
    const o = out();
    const { fn, calls } = caller(blocked, zonesOk, o);
    const r = await runGate({ sequenceId: 's', outputPath: o, override: true }, fn);
    expect(r.status).toBe('BLOCKED');
    expect(r.next).toMatch(/overrideReason/);
    expect(calls.map((c) => c[0])).not.toContain('export_sequence');
  });

  it('renders on override and records the reason', async () => {
    const o = out();
    const { fn, calls } = caller(blocked, zonesOk, o);
    const r = await runGate({ sequenceId: 's', outputPath: o, override: true, overrideReason: 'client asked for it tonight' }, fn);
    expect(r.overridden).toBe(true);
    expect(r.status).toBe('RENDERED');
    const rec = calls.find((c) => c[0] === 'record_qa_check')![1];
    expect(rec).toMatchObject({ passed: false, name: 'export gate override' });
    expect(rec.detail).toMatch(/client asked for it tonight/);
  });

  it('renders a clean sequence and checks the file', async () => {
    const o = out();
    const { fn, calls } = caller(pass, zonesOk, o);
    const r = await runGate({ sequenceId: 's', outputPath: o }, fn);
    expect(r.status).toBe('RENDERED');
    expect(r.steps.map((s) => s.step)).toEqual(['technical QA', 'safe zones', 'render', 'loudness', 'export_black_frames']);
    expect(calls.filter((c) => c[0] === 'run_technical_qa')[1]![1]).toMatchObject({ exportPath: o });
  });

  it('skips the safe-zone check for landscape workflows', async () => {
    const o = out();
    const { fn, calls } = caller(pass, zonesBad, o);
    await runGate({ sequenceId: 's', outputPath: o, workflow: 'youtube_landscape' }, fn);
    expect(calls.map((c) => c[0])).not.toContain('check_safe_zones');
  });
});

describe('export_with_gate', () => {
  it('never renders over an existing file', async () => {
    const o = path.join(mkdtempSync(path.join(os.tmpdir(), 'bx-gate-')), 'exists.mp4');
    writeFileSync(o, 'x');
    const r = await executeGateTool('export_with_gate', { sequenceId: 's', outputPath: o }, jest.fn());
    expect(r.error).toMatch(/already exists/);
  });
});
