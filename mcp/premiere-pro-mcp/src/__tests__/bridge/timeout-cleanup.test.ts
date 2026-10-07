/**
 * H4: a timed-out request is withdrawn so the panel cannot run it later, a late
 * response is cleaned up, and orphaned responses are swept — while normal
 * requests behave exactly as before.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeTimeoutError, PremiereProBridge } from '../../bridge/index.js';

function bridgeIn(dir: string): PremiereProBridge {
  const b = new PremiereProBridge();
  Object.assign(b as any, { tempDir: dir, isInitialized: true });
  b.lateResponsePollMs = 20;
  b.lateResponseWatchMs = 2000;
  return b;
}

const files = (dir: string) => fs.readdirSync(dir).sort();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stand-in for the CEP panel: answers each command file it finds. */
function fakePanel(dir: string, answer: unknown, delayMs = 30) {
  const timer = setInterval(() => {
    for (const f of fs.readdirSync(dir)) {
      if (!/^command-.+\.json$/.test(f)) continue;
      const cmd = path.join(dir, f);
      setTimeout(() => {
        if (!fs.existsSync(cmd)) return;
        fs.writeFileSync(cmd.replace('command-', 'response-'), JSON.stringify({ success: true, result: answer }));
        fs.unlinkSync(cmd);
      }, delayMs);
    }
  }, 10);
  return () => clearInterval(timer);
}

describe('bridge timeout clean-up', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-bridge-'));
  });

  it('answers a normal request and leaves nothing behind (unchanged)', async () => {
    const b = bridgeIn(dir);
    const stop = fakePanel(dir, { ok: 1 });
    await expect(b.executeScript('return 1;', 5000)).resolves.toEqual({ ok: 1 });
    stop();
    expect(files(dir)).toEqual([]);
  });

  it('withdraws the command file on timeout so the panel cannot run it later', async () => {
    const b = bridgeIn(dir);
    const err = await b.executeScript('return 1;', 200).catch((e) => e);
    expect(err).toBeInstanceOf(BridgeTimeoutError);
    expect(err.message).toMatch(/withdrawn and will not run/);
    expect(files(dir).filter((f) => f.startsWith('command-'))).toEqual([]);
  });

  it('leaves unrelated files alone while watching for a late response', async () => {
    const b = bridgeIn(dir);
    const unrelated = path.join(dir, 'response-someone-else.json');
    fs.writeFileSync(unrelated, '{}');
    await b.executeScript('return 1;', 200).catch(() => undefined);
    await wait(150);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it('cleans up the late response for the request that timed out', async () => {
    const b = bridgeIn(dir);
    let responseFile = '';
    const spy = jest.spyOn(b as any, 'watchForLateResponse');
    await b.executeScript('return 1;', 200).catch(() => undefined);
    responseFile = spy.mock.calls[0]![0] as string;
    expect(path.basename(responseFile)).toMatch(/^response-.+\.json$/);
    fs.writeFileSync(responseFile, JSON.stringify({ success: true, result: 'late' }));
    await wait(150);
    expect(fs.existsSync(responseFile)).toBe(false);
  });

  it('sweeps old orphaned responses but keeps fresh ones and non-response files', async () => {
    const b = bridgeIn(dir);
    const old = path.join(dir, 'response-old.json');
    const fresh = path.join(dir, 'response-fresh.json');
    const other = path.join(dir, 'panel-state.json');
    for (const f of [old, fresh, other]) fs.writeFileSync(f, '{}');
    const past = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(old, past, past);
    fs.utimesSync(other, past, past);
    expect(await b.sweepOrphanResponses(true)).toBe(1);
    expect(files(dir)).toEqual(['panel-state.json', 'response-fresh.json']);
  });

  it('never sweeps a response a request is waiting for', async () => {
    const b = bridgeIn(dir);
    const waiting = path.join(dir, 'response-waiting.json');
    fs.writeFileSync(waiting, '{}');
    const past = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(waiting, past, past);
    (b as any).awaiting.add(waiting);
    expect(await b.sweepOrphanResponses(true)).toBe(0);
    expect(fs.existsSync(waiting)).toBe(true);
  });
});
