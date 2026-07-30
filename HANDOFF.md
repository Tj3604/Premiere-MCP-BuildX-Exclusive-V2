# Session Handoff — 2026-07-27

> **Earlier project record.** This documents the **Hometour Sat 6-20-26** project on
> `/Volumes/BuildX-TM`. A later project is recorded in **`SHORTS-HANDOFF.md`** (updated
> 2026-07-29) on a different volume — **read that first.** This file remains accurate for the
> system build and the tooling lessons below.
>
> Permanent BuildX knowledge — brand, editorial, workflow, tool behaviour — is in
> `knowledge/buildx/`.

State of the build, so a fresh session doesn't re-derive any of it.

## Status: built and verified end to end

Everything works. Read [CLAUDE.md](CLAUDE.md) first — it is the operating manual.

## What was proven live against Premiere Pro 2026 (26.3.0)

Round trip confirmed: MCP server → ExtendScript → CEP panel → Premiere → response.

A full write test ran in the user's open project and was cleaned up:
created a scratch sequence, imported a rendered ProRes 4444 graphic, placed two clips using
`sourceInPoint`/`sourceOutPoint`, read the timeline back, deleted the sequence.

Also verified independently:

- **Transcription** — `scripts/transcribe.mjs` on real audio → 106 words, word-level timestamps.
- **Graphics** — HyperFrames composition → WebM → ProRes 4444 with a real alpha channel
  (measured: alpha min 256 / max 3750, so genuinely transparent). Example lives in
  `graphics/alpha-test/`, render in `renders/`.

## Two real bugs found and handled — do not regress these

1. **One-frame black gaps.** Premiere floors `sourceInPoint`/`sourceOutPoint` but rounds
   timeline `time`. `scripts/plan-cut.mjs` now works in integer frames and emits source
   points at the frame midpoint, timeline positions at the boundary. Verified on the real
   timeline: clips butt at exactly 1.76667 with no gap. Never hand-compute in/out points.

2. **97 of 281 MCP tools report success and do nothing.** See
   [TOOL-RELIABILITY.md](TOOL-RELIABILITY.md). A response with `"accepted": true` and the
   note *"Expanded tool dispatched through the native Premiere bridge"* means nothing
   happened. Always confirm writes with a read tool.

## Every session: start the bridge

Premiere open → `Window > Extensions > MCP Bridge (CEP)` → temp dir `/tmp/premiere-mcp-bridge`
→ **Start Bridge**. Stopping and restarting the bridge is enough after a Premiere restart;
the extension stays installed.

If tool calls time out, this is the cause. `node scripts/mcp-call.mjs get_project_info`
is the fastest way to check.

## Loose end

One stray item is in the user's project panel: `lower-third-test_ProRes4444.mov`
(itemCount 109, was 108). `delete_project_item` is one of the no-op tools, so it must be
removed by hand — or discarded by closing the project without saving. **Nothing was ever
saved to disk**; `save_project` was never called.

## Where the conversation stopped

The user asked for a timeline to be built, then dismissed the scoping question and said
they wanted to continue in a new chat. **Nothing is in progress. Wait for their instruction.**

Footage surveyed and ready, at `/Volumes/BuildX-TM/Hometour Sat - 6-20-26/Footage/`
— 38 clips, 66.9 min total, all with AAC audio. Longest takes (likely the actual Q&A):

| clip | duration |
|---|---|
| `MVI_6842.MP4` | 10:00 |
| `MVI_6850.MP4` | 9:24 |
| `MVI_6845.MP4` | 6:23 |
| `MVI_6848.MP4` | 5:20 |
| `MVI_6852.MP4` | 4:49 |
| `MVI_6836.MP4` | 4:27 |

Open project when the session ended: `Home Tour Q&A's copy.prproj`
(`/Volumes/BuildX-TM/Hometour Sat - 6-20-26/Project/`), 18 sequences, active sequence
"Master Timeline". It is real client work — create new sequences, do not modify the
existing 18.

## To pick up

```bash
cd /Users/thomasmartell/Downloads/claude-video-editor
node scripts/mcp-call.mjs get_project_info    # confirms the bridge is live
```

Then use the `rough-cut` or `graphic-to-premiere` skills.
