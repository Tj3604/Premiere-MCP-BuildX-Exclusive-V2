/**
 * Pre-export gate: QA before and after a render, using the checks that already
 * exist — technical QA for the workflow, the safe-zone check on graphics, then
 * loudness and black frames on the rendered file.
 *
 * A required check that fails blocks the render. override:true with a written
 * reason lets it through; the reason is recorded in telemetry and the result.
 * After the render nothing can be un-rendered, so a post-render failure keeps the
 * file and marks the result FAILED with the fix to run. There is no "approved"
 * outcome — Thomas proof-watches before delivery (feedback: proof-watch first).
 */

import { existsSync } from 'node:fs';
import { DEFAULT_TARGET, measureLoudness } from '../audio/loudness.js';
import { z } from 'zod';
import type { ToolCaller } from './premiere-reader.js';

export type GateStatus = 'BLOCKED' | 'RENDERED' | 'RENDERED_WITH_PROBLEMS' | 'FAILED';

export interface GateArgs {
  sequenceId: string;
  outputPath: string;
  workflow?: string;
  presetPath?: string;
  /** 'ame' = export_sequence (480 MB cap). 'direct' = sequence.exportAsMediaDirect, then compress_export. */
  renderMethod?: 'ame' | 'direct';
  override?: boolean;
  overrideReason?: string;
}

export interface GateStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface GateResult {
  status: GateStatus;
  overridden: boolean;
  overrideReason: string | null;
  steps: GateStep[];
  blockers: string[];
  problems: string[];
  outputPath: string | null;
  next: string;
}

const VERTICAL = new Set(['podcast_short', 'social_vertical', 'interview_clip', 'home_tour']);

function parse(r: any): any {
  return typeof r === 'string' ? JSON.parse(r) : r;
}

/** Blocking items from a QA report, as short readable lines. */
export function qaBlockers(report: any): string[] {
  const status = report?.finalStatus;
  if (status !== 'BLOCKED' && status !== 'FAILED') return [];
  const items: any[] = report?.data?.blockingItems ?? [];
  const lines = items.map((i) => `${i.code ?? i.checkId ?? 'check'}: ${i.message ?? i.detail ?? 'failed'}`);
  // QA also blocks while an objective fix is pending; those are not blockingItems.
  for (const c of (report?.data?.technical ?? []) as any[]) {
    if (c.status === 'AUTO_FIX') {
      const what = (c.issues ?? []).map((i: any) => i.message).filter(Boolean).join('; ') || c.detail || 'fix pending';
      lines.push(`${c.checkId ?? c.id}: ${what} — auto-fixable: run apply_safe_qa_fixes`);
    } else if (c.status === 'ERROR') {
      lines.push(`${c.checkId ?? c.id}: could not run — ${c.error ?? c.detail ?? 'error'}`);
    }
  }
  return lines.length ? lines : [`QA ${status}`];
}

export async function runGate(args: GateArgs, call: ToolCaller): Promise<GateResult> {
  const workflow = args.workflow ?? 'podcast_short';
  const steps: GateStep[] = [];
  const blockers: string[] = [];
  const problems: string[] = [];

  // 1. Technical QA — read-only, no fixes, no visual layer.
  const qa = parse(await call('run_technical_qa', { sequenceId: args.sequenceId, workflow }));
  const qaBlock = qaBlockers(qa);
  steps.push({ step: 'technical QA', ok: qaBlock.length === 0, detail: `${qa?.finalStatus ?? 'no result'} — ${qa?.finalScore?.percent ?? '?'}% of required checks` });
  blockers.push(...qaBlock);

  // 2. Safe zones on every graphic (vertical workflows).
  if (VERTICAL.has(workflow)) {
    const zones = parse(await call('check_safe_zones', { sequenceId: args.sequenceId }));
    if (!zones?.success) {
      steps.push({ step: 'safe zones', ok: false, detail: zones?.error ?? 'could not run' });
      blockers.push(`safe zones: ${zones?.error ?? 'could not run'}`);
    } else {
      const fails = (zones.items ?? []).filter((i: any) => i.verdict === 'fail');
      steps.push({ step: 'safe zones', ok: fails.length === 0, detail: `${zones.pass} pass, ${zones.warn} warn, ${zones.fail} fail` });
      for (const f of fails) blockers.push(`safe zones: ${f.name} — ${Object.entries(f.zones ?? {}).map(([p, z]) => `${p}: ${(z as string[]).join(', ')}`).join('; ')}`);
    }
  }

  const overridden = blockers.length > 0 && !!args.override;
  const reason = args.overrideReason?.trim() ?? '';
  if (blockers.length && !args.override) {
    return { status: 'BLOCKED', overridden: false, overrideReason: null, steps, blockers, problems, outputPath: null, next: 'Fix the blockers, or pass override:true with overrideReason to render anyway.' };
  }
  if (overridden && !reason) {
    return { status: 'BLOCKED', overridden: false, overrideReason: null, steps, blockers, problems, outputPath: null, next: 'An override needs overrideReason — say why it is OK to ship with these blockers.' };
  }
  if (overridden) {
    await call('record_qa_check', { passed: false, name: 'export gate override', detail: `${reason} | blockers: ${blockers.join(' | ')}` }).catch(() => undefined);
  }

  // 3. Render.
  let render: any;
  if ((args.renderMethod ?? 'ame') === 'direct') {
    if (!args.presetPath) throw new Error('renderMethod "direct" needs presetPath (an .epr).');
    render = parse(
      await call('execute_extendscript', {
        script: `var s = __findSequence(${JSON.stringify(args.sequenceId)}); if (!s) return JSON.stringify({ success: false, error: "Sequence not found" }); var r = s.exportAsMediaDirect(${JSON.stringify(args.outputPath)}, ${JSON.stringify(args.presetPath)}, 0); return JSON.stringify({ success: String(r) === "No Error", result: String(r) });`
      })
    );
    if (render?.success) {
      const cap = parse(await call('compress_export', { filePath: args.outputPath }));
      if (cap && cap.success === false) problems.push(`size cap: ${cap.error ?? 'compress_export failed'}`);
    }
  } else {
    render = parse(await call('export_sequence', { sequenceId: args.sequenceId, outputPath: args.outputPath, ...(args.presetPath ? { presetPath: args.presetPath } : {}) }));
  }
  const rendered = existsSync(args.outputPath);
  steps.push({ step: 'render', ok: rendered && render?.success !== false, detail: rendered ? args.outputPath : render?.error ?? render?.result ?? 'no file written' });
  if (!rendered) {
    return { status: 'FAILED', overridden, overrideReason: overridden ? reason : null, steps, blockers, problems: [...problems, 'render produced no file'], outputPath: null, next: 'Check the bridge / AME and try renderMethod "direct".' };
  }

  // 4. The file: loudness, then the existing export checks (black frames, levels, duration).
  try {
    const l = await measureLoudness(args.outputPath);
    const ok = Math.abs(l.integratedLufs - DEFAULT_TARGET.lufs) <= 0.5 && l.truePeakDbtp <= DEFAULT_TARGET.truePeak;
    steps.push({ step: 'loudness', ok, detail: `${l.integratedLufs} LUFS, ${l.truePeakDbtp} dBTP` });
    if (!ok) problems.push(`loudness ${l.integratedLufs} LUFS / ${l.truePeakDbtp} dBTP — run normalize_loudness on the file`);
  } catch (error) {
    steps.push({ step: 'loudness', ok: false, detail: error instanceof Error ? error.message : String(error) });
    problems.push('loudness could not be measured');
  }
  const post = parse(await call('run_technical_qa', { sequenceId: args.sequenceId, workflow, exportPath: args.outputPath }));
  const exportChecks = ((post?.data?.technical ?? []) as any[]).filter((c) => String(c.checkId ?? c.id ?? '').startsWith('export_'));
  for (const c of exportChecks) {
    const ok = c.status === 'PASS' || c.status === 'SKIPPED';
    steps.push({ step: String(c.checkId ?? c.id), ok, detail: `${c.status}${c.detail ? ` — ${c.detail}` : ''}` });
    if (!ok) problems.push(`${c.checkId ?? c.id}: ${(c.issues ?? []).map((i: any) => i.message).join('; ') || c.status}`);
  }

  return {
    status: problems.length ? 'RENDERED_WITH_PROBLEMS' : 'RENDERED',
    overridden,
    overrideReason: overridden ? reason : null,
    steps,
    blockers,
    problems,
    outputPath: args.outputPath,
    next: problems.length ? 'The file is kept. Fix the problems above before delivery.' : 'Rendered and checked. Proof-watch before delivery — this is not an approval.'
  };
}


export const GATE_TOOLS = [
  {
    name: 'export_with_gate',
    description:
      'Export with QA before and after. Before: technical QA for the workflow (sequence settings, frame rate, gaps, logo, logo safe zone, end card, audio) and, for vertical workflows, check_safe_zones on every graphic — any failure BLOCKS the render and nothing is written. override:true + overrideReason renders anyway and records the reason in telemetry. Render: export_sequence (AME, 480 MB cap) or renderMethod "direct" (exportAsMediaDirect + compress_export). After: loudness (-14 LUFS / -1 dBTP) and the export checks (black frames, levels, duration); a failure keeps the file and returns RENDERED_WITH_PROBLEMS with the fix. Never "approved" — proof-watch before delivery.',
    inputSchema: z.object({
      sequenceId: z.string().min(1),
      outputPath: z.string().min(1).describe('Absolute path for the render.'),
      workflow: z.string().optional().describe('QA workflow, default podcast_short.'),
      presetPath: z.string().optional().describe('.epr preset (required for renderMethod "direct").'),
      renderMethod: z.enum(['ame', 'direct']).optional(),
      override: z.boolean().optional().describe('Render despite blockers. Needs overrideReason.'),
      overrideReason: z.string().optional()
    })
  }
];

export const isGateTool = (name: string) => name === 'export_with_gate';
export const getGateTools = () => GATE_TOOLS;

export async function executeGateTool(name: string, args: Record<string, any>, call: ToolCaller): Promise<any> {
  if (name !== 'export_with_gate') return { success: false, error: `Unknown tool '${name}'` };
  if (existsSync(args.outputPath)) return { success: false, error: `${args.outputPath} already exists — renders never overwrite (Premiere loses the media link). Pick a new name.` };
  try {
    const r = await runGate(args as GateArgs, call);
    // success says the gate ran (as run_buildx_qa does); the verdict is status.
    // A block or a render with problems is not a tool failure in telemetry.
    return { success: r.status !== 'FAILED', ...r };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
