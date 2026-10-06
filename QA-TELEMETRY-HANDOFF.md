# Handoff — Telemetry + Automated QA

Written 2026-08-24. Both features are **built, typechecked, tested and working**.
Nothing is half-finished. This file records what was verified, what was not, and
what is worth doing next.

## State: complete and buildable

```bash
cd mcp/premiere-pro-mcp && npm run build   # clean
NODE_OPTIONS=--experimental-vm-modules npx jest
```

**189 tests: 173 pass, 16 fail.** All 16 failures are **pre-existing and unrelated** —
5 suites use `jest.mock()` without importing `jest` from `@jest/globals`, which does
not work under this repo's native-ESM jest config. Measured before any of this work
began: 16 failing then, 16 failing now. Fixing them is a separate, unstarted job.

The server advertises **306 tools** (283 original + 15 telemetry + 7 QA +
`get_param_value`), zero duplicate names, and starts cleanly over stdio.

## What was verified, and how

| Verified live | Method |
|---|---|
| Telemetry end to end | Mock session through the real dispatcher; SQLite inspected directly; `telemetry_errors` empty |
| Telemetry survives its own failure | Unopenable DB path — tool results still returned, errors still surfaced |
| QA on a defective project | Controlled session through the real dispatcher: first-pass 62.5% → final 87.5% |
| Both auto-fixes | Applied **and confirmed by reading state back** — logo top edge −31px → 192px, gap 1 frame → 0 |
| Auto-fix refusal | Missing end card correctly not fixed; run held at `BLOCKED` |
| Export / black frames / audio / frame extraction | **Real ffmpeg-rendered files**, real ffprobe |
| Black-frame threshold | Measured on real H.264: black = luma 16, dark shot = 25, content = 126 |

## NOT verified — the honest gap

**No Premiere-dependent check has run against a live bridge.** Premiere was open on
2026-08-24 but the CEP panel was not started, so `get_project_info` timed out.

Every Premiere check is tested against a **stateful fake** that mutates on write, so a
fix genuinely changes what the next read returns. That proves the logic. It does not
prove Premiere behaves as expected.

### To close that gap — first thing next session

1. Premiere → `Window > Extensions > MCP Bridge (CEP)` → temp dir
   `/tmp/premiere-mcp-bridge` → **Start Bridge**.
2. Open a **sandbox** project, not a live `X#### (surname)` one.
3. Confirm the bridge: `node scripts/mcp-call.mjs get_project_info`
4. Read-only first — this mutates nothing:
   ```bash
   node scripts/mcp-call.mjs list_sequences
   node scripts/mcp-call.mjs run_technical_qa '{"sequenceId":"SEQ_ID"}'
   ```
5. Then verify the new read tool on a real logo clip:
   ```bash
   node scripts/mcp-call.mjs get_param_value '{"clipId":"...","componentName":"Motion","paramName":"Position"}'
   ```
   **This is the highest-value single check.** `logo_safe_zone` and `fix_logo_safe_zone`
   both depend on it, and it has never touched Premiere.
6. Only then, in the sandbox, test auto-fix on a deliberately mis-placed logo:
   ```bash
   node scripts/mcp-call.mjs apply_safe_qa_fixes '{"sequenceId":"SEQ_ID"}'
   ```

Build a sandbox with the five defects from the brief — one-frame gap, missing logo,
bad safe-zone placement, missing end card, wrong resolution — and confirm each is
detected, classified, and only the safe ones repaired.

## Logo placement — decided 2026-10-06

The upper-right placement (`0.794 / 0.160`, scale 31) is the 1080x1920 standard. It is
carried as `SHORTS_LOGO_PLACEMENT` in `src/qa/config.ts` and passes QA despite its 41px
right-edge breach. safe-zones.md, design-system.md and CLAUDE.md now say the same.

## Recommended next, in order

1. **Live-verify against the bridge** (above). Nothing else matters as much.
2. **Instrument the pipeline scripts.** `transcribe-x.mjs`, `render-graphic.mjs`,
   `reframe-vertical.mjs` run as separate processes and never touch `executeTool`, so
   the biggest blocks of automated time have to be hand-fed via `recordOperation`. A
   small `scripts/telemetry-emit.mjs` writing to the same SQLite file would make
   "automated processing time" fully measured rather than partly estimated.
3. **Fix the 5 broken pre-existing test suites** — one-line import change each.
4. **Wire QA into the end of the shorts workflow** so a batch cannot be reported done
   without a QA pass.

## Where things live

```
mcp/premiere-pro-mcp/src/telemetry/     session/operation/stage timing, SQLite, reports
mcp/premiere-pro-mcp/src/qa/            checks/, fixes/, runner, scoring, geometry
mcp/premiere-pro-mcp/data/              telemetry.sqlite + qa/last-qa-report.json (gitignored)
```

Docs: `README.md` — *Performance Telemetry* and *Automated QA*. Operating rules:
`CLAUDE.md`. Full rationale: `CHANGELOG.md` 2.5 and 2.6.

## Live bridge test — 2026-10-06

Ran against the real CEP bridge in a throwaway project:
`sandbox/qa-live-2026-10-06/QA Live Sandbox.prproj` (sequences QA Clean / QA Defects /
QA No Logo; raw reports saved alongside as tqa-*.json and fix-*.json). The server is now
registered user-scope in Claude Code as `premiere_pro`.

**Verified live:** `get_param_value` (Position/Scale read back exactly as set),
resolution, frame rate, gap detection (caught a real 179-frame-clip gap I hadn't
intended), overlaps, audio, logo presence/missing, end card present/missing, and the logo
safe-zone nudge (applied, read back, cleared — top and right edges).

**Gap auto-fix bugs: FIXED and re-verified live the same day (v2.6.1, see CHANGELOG).**
The desync, the stale-snapshot cascade and the weak read-back are all gone. Live proof is in
the sandbox sequences `Gap Chain Handles` (3 gaps closed by extension, nothing moved, end card
and logo untouched), `Gap No Handle` (both declined, zero writes) and `Gap Trailing` (clip
moved with its audio). Reports are in `fix2-*.json` and the filled frames in `frames/`.

Still open, not a gap bug: the resolution FAIL message says resolution "cannot be changed
after creation", but `seq.setSettings()` changed it fine in this test.

**Logo decision: MADE (2026-10-06).** Thomas confirmed the upper-right placement (858,308 /
scale 31) as the standard. It is an approved placement in `src/qa/config.ts`, so QA passes it.
Verified live on `QA Clean`.
