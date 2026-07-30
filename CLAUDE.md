# Claude Video Editor

Prompt-driven video editing: Claude cuts footage and builds motion graphics, then places
both onto a real Premiere Pro timeline.

Two engines:

- **HyperFrames** — motion graphics authored as HTML/CSS/GSAP, rendered to video.
- **Premiere Pro MCP** — 281 tools that drive Premiere Pro 2026 over a CEP bridge.

## Before you touch Premiere — READ THIS

Premiere tools fail silently-ish (they time out) unless the bridge is live. Every session:

1. Premiere Pro is open with a project loaded.
2. `Window > Extensions > MCP Bridge (CEP)` panel is open.
3. Temp directory is `/tmp/premiere-mcp-bridge`.
4. **Start Bridge** has been clicked (panel shows it running).

If tool calls hang or time out, this is the cause ~90% of the time. Check the panel first,
before debugging anything else. Right-click the panel → `Reload` if it looks stuck.

Verify the install at any time:

```bash
cd mcp/premiere-pro-mcp && npm run setup:doctor
```

## Layout

```
footage/      raw source video (or reference it anywhere by absolute path)
transcripts/  <name>.md (readable, timecoded) + <name>.words.json (word-level)
graphics/     one HyperFrames composition per subfolder
renders/      rendered graphics, ready to import
presets/      reusable look/audio settings
scripts/      the pipeline (see below)
mcp/          the Premiere Pro MCP server + CEP bridge source
```

## Workflow 1 — Rough cut from a transcript

```bash
# 1. Transcribe. Writes transcripts/<name>.md and <name>.words.json
node scripts/transcribe.mjs "/absolute/path/to/raw.mp4"

# 2. READ transcripts/<name>.md and choose which lines survive.
#    Each line is prefixed with its [start-end] in seconds.

# 3. Turn keeps into exact timeline placements.
node scripts/plan-cut.mjs \
  --keep "1.2-5.4,10.0-14.2,22.8-29.1" \
  --transcript "transcripts/<name>.words.json" \
  --fps 30 \
  --sequence-id <SEQ_ID> \
  --project-item-id <ITEM_ID>
```

Then in Premiere via MCP:

1. `import_media` with the absolute footage path → note the returned project item ID.
2. `create_sequence` (or `list_sequences` to reuse one) → note the sequence ID.
3. Call `add_to_timeline` once per entry in `plan-cut`'s `calls` array, **in order**.

**Never compute timeline offsets by hand.** `plan-cut.mjs` handles sorting, merging
overlaps, frame snapping, and the cumulative offsets that keep clips butted together.
Doing this arithmetic inline is how you get one-frame black gaps and drift.

### Cutting judgement

The transcript is a script, not a waveform. Cut for meaning:

- Drop filler openings ("okay so", "basically", "um"), restarts, and repeated takes.
- When someone says the same thing twice, keep the tighter delivery.
- Keep the first clean statement of each idea; drop the re-explanation.
- Default `--pad 0.05` keeps a breath around each cut. Raise to `0.12` if words clip.
- "Cut it hard" means keep only load-bearing sentences — expect to lose 50-70%.

## Workflow 2 — Motion graphics

```bash
# 1. Scaffold (once per graphic)
cd graphics && npx hyperframes@latest init my-graphic --example blank --non-interactive

# 2. Author index.html — invoke the `hyperframes` skill first, it is the source of truth.

# 3. Lint before rendering; it catches the timing-attribute mistakes that render as blank frames.
cd graphics/my-graphic && npx hyperframes@latest lint

# 4. Render
node scripts/render-graphic.mjs graphics/my-graphic --alpha --fps 30 --quality high --name my-graphic
```

`--alpha` → transparent **ProRes 4444 .mov** for overlays (lower thirds, callouts, captions).
Without it → **MP4** for full-frame graphics.

**Overlays must use `--alpha`, and the composition must set `background: transparent`
on `html, body`.** A composition with a solid background renders an opaque rectangle that
covers the footage underneath it.

Then `import_media` the printed path and `add_to_timeline` on a **video track above** the
footage (e.g. `trackIndex: 1` when footage is on `0`).

## Creative direction is the input, not the output

The system executes; it does not invent taste. Vague prompts produce generic graphics.
Specify style concretely — frame rate feel (8fps stepped vs 30fps smooth), texture
(halftone, grain, paper), palette, typography, and the beat-by-beat action. When the user
is vague, ask what look they want or propose 2-3 specific directions. Don't silently pick.

## 97 of the 281 tools lie about succeeding

Read [TOOL-RELIABILITY.md](TOOL-RELIABILITY.md) before trusting any tool result.

The expanded tool dispatcher has a catch-all that returns `success: true` for tools it
never implemented. **Verified live:** `delete_project_item` returned success and the item
was still in the project.

A response containing `"accepted": true` and the note *"Expanded tool dispatched through
the native Premiere bridge"* means **nothing happened**. Real tools return real data — IDs,
names, durations, counts.

Never tell the user an operation succeeded on the strength of `accepted: true`. Confirm
with `get_project_info`, `list_sequence_tracks`, or `list_project_items` — or say it needs
doing by hand.

## Frame math: why `plan-cut.mjs` exists

Premiere converts seconds to frames **two different ways**, verified live:

- `sourceInPoint` / `sourceOutPoint` → **floored**
- timeline `time` → **rounded**

So a source point must be emitted at the frame's *midpoint* (`(frame + 0.5) / fps`) to
survive flooring, while a timeline position must be emitted at the *boundary* (`frame / fps`)
because the midpoint sits exactly on the rounding tie and lands a frame late.

Getting this wrong produced a one-frame black gap between every clip — invisible in the
tool's success response, obvious on playback. `plan-cut.mjs` works in integer frames and
handles both conversions. **Do not hand-compute in/out points.**

## Standing rule: the BuildX logo

Every BuildX project contains `BuildX Logo WHITE.PNG.png`. Put it on **V3** at
**x 540, y 74, scale 54%** on every edit, without being asked.

Those are Premiere's Effect Controls pixel values for a 1080x1920 sequence. The scripting
API wants **normalized** coordinates, so convert — `x/width, y/height` → `[0.5, 0.0385417]`.
Recompute if the sequence is not 1080x1920.

Use `set_param_value` (added locally — see below), not `set_clip_position`/`set_clip_scale`,
which are fake no-ops.

## `set_param_value` — a local addition

The stock server cannot set 2D parameters: `add_keyframe` takes a single `number`, so
Position (`[x, y]`) is rejected outright, and all the position/scale tools are no-ops.

`set_param_value` was added to `src/tools/index.ts` to fix this. It accepts a number **or**
an array, clears any existing keyframes so the value is genuinely static, and returns the
value read back from Premiere:

```
set_param_value {"clipId":"...","componentName":"Motion","paramName":"Position","value":[0.5,0.0385]}
set_param_value {"clipId":"...","componentName":"Motion","paramName":"Scale","value":54}
```

`add_keyframe` was also fixed to `JSON.stringify` its value, so it now handles 2D params too.
Rebuild after changing the server: `cd mcp/premiere-pro-mcp && npm run build`.

## Verify overlays visually with `export_frame`

`export_frame` is real and is the fastest way to confirm an overlay actually landed —
tool success proves nothing. Note it **appends** its own extension, so `foo.png` is written
as `foo.png.png`.

## Gotchas found the hard way

- **`timeout` does not exist on macOS.** Don't use it in scripts; background the process
  and `kill` it instead.
- **Alpha WebM does not import into Premiere.** Always transcode to ProRes 4444 —
  `render-graphic.mjs --alpha` does this. The ffmpeg input needs `-c:v libvpx-vp9`
  explicitly, or the alpha channel is silently dropped and you get a black box.
- **`detect_silence` needs ffmpeg on PATH** and reads the media file directly — Premiere's
  scripting API cannot read audio levels at all. It only reports intervals; it never cuts.
- **`get_render_queue_status` requires Adobe Media Encoder** and returns an honest error
  without it.
- **`remove_effect` does not exist** — Premiere's API cannot remove an applied effect.
  Plan effect application accordingly; undo is `undo`.
- **`delete_sequence` works; `delete_project_item` does not.** Removing an imported clip
  from the project panel has to be done by hand in Premiere.
- **Sub-frame ranges vanish.** `plan-cut.mjs` skips and warns about ranges shorter than
  one frame rather than emitting a zero-length clip.
- Transcription writes `transcript.json` into whatever project dir it is given —
  `transcribe.mjs` uses a scratch dir so it never litters the source footage folder.

## Useful MCP tools

`list_sequences`, `get_project_info`, `list_project_items` — orient before editing.
`import_media`, `create_sequence`, `create_bin` — setup.
`add_to_timeline` (`sourceInPoint`/`sourceOutPoint`/`insertMode`) — the core placement tool.
`razor_timeline_at_time`, `split_clip`, `trim_clip`, `ripple_delete` — surgical fixes.
`apply_effect`, `add_transition` — treatment. `export_sequence` — delivery.
`save_project`, `undo` — safety.

Prefer assembling with `add_to_timeline` + source in/out over razor-then-delete. It is one
call per clip, it is deterministic, and it never disturbs clips already on the timeline.
