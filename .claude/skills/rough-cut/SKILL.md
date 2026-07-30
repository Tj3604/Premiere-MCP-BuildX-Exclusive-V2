---
name: rough-cut
description: Rough-cut raw talking-head footage onto a Premiere Pro timeline. Use when asked to cut, trim, tighten, or assemble raw footage; remove filler, dead air, rambling, or bad takes; make a first pass or rough cut; or "cut this hard" / "only keep the essential parts". Transcribes the footage, picks keep-ranges from the transcript, and places the selects on the timeline via the Premiere Pro MCP.
---

# Rough Cut

Turns raw footage into an assembled Premiere timeline by cutting from the transcript.

## Preflight

The Premiere MCP bridge must be live or every timeline call will time out:
Premiere open → `Window > Extensions > MCP Bridge (CEP)` → temp dir `/tmp/premiere-mcp-bridge`
→ **Start Bridge**. Confirm before doing anything else.

## Step 1 — Transcribe

```bash
node scripts/transcribe.mjs "/absolute/path/to/raw.mp4"
```

Writes `transcripts/<name>.md` (timecoded, readable) and `transcripts/<name>.words.json`
(word-level). Long footage takes a few minutes — that's whisper running locally.

## Step 2 — Choose what survives

Read `transcripts/<name>.md`. Every line carries its `[start-end]` in seconds.

Select for meaning, not just silence:

- Drop filler openings, false starts, restarts, and "let me say that again" takes.
- When a point is made twice, keep the tighter delivery and drop the other.
- Keep the first clean statement of an idea; drop the re-explanation.
- Cut throat-clearing ("okay so", "basically", "what I want to talk about is").
- **"Cut it hard" = keep only load-bearing sentences.** Expect to remove 50-70% of runtime.

State the target: how long the raw is, how long your cut is, and what you dropped.

## Step 3 — Plan the placements

```bash
node scripts/plan-cut.mjs \
  --keep "1.2-5.4,10.0-14.2,22.8-29.1" \
  --transcript "transcripts/<name>.words.json" \
  --fps 30 \
  --sequence-id <SEQ_ID> \
  --project-item-id <ITEM_ID>
```

Options: `--pad` (handles, default `0.05`; raise to `0.12` if words clip), `--start`
(timeline offset — use this to append after an existing section), `--track`.

**Do not compute timeline offsets yourself.** This script sorts, merges padding overlaps,
snaps to the frame grid, and accumulates offsets. Hand arithmetic produces one-frame gaps.

Match `--fps` to the sequence's real frame rate.

## Step 4 — Place on the timeline

1. `import_media` — absolute path → returns the **project item ID**.
2. `list_sequences` to reuse a sequence, or `create_sequence` → returns the **sequence ID**.
3. Re-run `plan-cut.mjs` with the real IDs if you used placeholders.
4. Call `add_to_timeline` once per entry in `calls`, **in array order**.

Each call is already shaped for the tool — pass the object through unchanged.

## Step 5 — Verify and report

Check the resulting clip count and that the timeline ends where `timelineEndSeconds` said.
Then report: source duration → final duration, number of clips, what was cut and why.

Do not claim the cut is good; say what you did and let the user judge. Offer to tighten
further or restore anything you dropped.

## Notes

- Appending after existing content: pass `--start <seconds>` and place on the same track.
- `detect_silence` (MCP) finds dead air in the media file but never cuts. Use it to tighten
  pauses *within* a keep-range; it is not a substitute for reading the transcript.
- If the footage has no audio track, transcription fails — there is nothing to cut from.
