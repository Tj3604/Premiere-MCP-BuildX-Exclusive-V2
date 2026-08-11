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

**The bridge follows whatever project is frontmost in Premiere, and it has silently switched
projects mid-session.** Call `get_project_info` and confirm the project name before every
build step — not once at the start.

Verify the install at any time:

```bash
cd mcp/premiere-pro-mcp && npm run setup:doctor
```

## BuildX knowledge — read before starting work

Permanent BuildX knowledge lives in `knowledge/buildx/`. It is **not** loaded automatically.
Read the relevant file before beginning the task. If multiple files are listed, read them in
the order shown.

| Before you… | Read |
|---|---|
| Do anything BuildX, unsure where to start | `knowledge/buildx/README.md` |
| Write copy, a hook, a title or anything in BuildX's voice | `brand.md` |
| Build or style any graphic | `design-system.md`, then `safe-zones.md`, then `assets.md` |
| Place a logo, lower third, caption or card near a frame edge | `safe-zones.md` |
| Choose what to cut, or how to order a batch | `editorial.md` |
| Choose b-roll, or decide graphic vs footage | `broll.md` |
| Write or check a caption | `captions.md`, then `terminology.md` |
| Put a number, price or statistic on screen | `verified-facts.md` |
| Put a person's name on screen | `people.md` |
| Run a project end to end, or QA before export | `production-workflow.md` |
| Debug a Premiere tool that misbehaved | `premiere-gotchas.md` |

Four rules from that knowledge base that apply to every BuildX task, without exception:

- **Exact spoken dialogue only.** Never invent, reword or paraphrase a line.
- **Never put a name or place on screen that was inferred rather than confirmed.**
- **Check every on-screen figure against `verified-facts.md`**, including any qualifier it
  carries.
- **Every short gets the logo and the standard end card.** Never author a new CTA.

Unresolved decisions are tracked in `knowledge/buildx/open-questions.md`. **Three brand
questions are currently open** — the gold value, the typeface pair, and whether grain texture
is permitted. Until they are answered, match the composition you are extending rather than
picking a value.

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

The transcript is a script, not a waveform. Cut for meaning.

**Full selection and cutting doctrine — what survives, hook standards, length, pacing and
publication order — is in `knowledge/buildx/editorial.md`. Read it before choosing keeps.**

Three things that live here because they are always true:

- **Exact spoken dialogue only. Never invent, reword or paraphrase a line.**
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

**`--fps` must match the target sequence**, not default to 30. A 59.94 sequence needs the
rational form (`60000/1001`). Rendering at the wrong rate is silent — nothing errors.

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

**For BuildX work, do not invent or reinterpret the visual language.** The design system,
brand voice, editorial standards, and workflow are already defined in `knowledge/buildx/`.
Follow them rather than creating a new style.

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

`TOOL-RELIABILITY.md` is a **static source audit** — it can see whether a tool has an
implementation, not whether that implementation works. Six tools it lists as working fail
when called. **Live-verified behaviour is in `knowledge/buildx/premiere-gotchas.md`, and
where the two disagree, live observation wins.**

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

Every BuildX project contains `BuildX Logo WHITE.PNG.png`. Put it on **V3** on every edit,
without being asked.

For a 1080x1920 sequence: Position `[0.5, 0.1530]`, Scale **40**. **Values for other
sequence formats, and how to derive a new one, are in `knowledge/buildx/design-system.md`** —
the normalized position is the same for any 9:16 sequence, only the scale changes.

> **Why 0.1530 and not the old 0.0385417:** the top **192px** of a 9:16 frame is title-safe —
> on iPhone the Dynamic Island covers it, and it was hiding the logo. `0.1530` at scale 40
> puts the logo's top edge at 216px, 24px clear of that line. The old `0.0385417` / scale 54
> put it at **−31px**, cropped off the top of frame entirely. **Do not revert it.**
> See `knowledge/buildx/safe-zones.md`.

Use `set_param_value` (added locally — see below), not `set_clip_position`/`set_clip_scale`,
which are fake no-ops.

## `set_param_value` — a local addition

The stock server cannot set 2D parameters: `add_keyframe` takes a single `number`, so
Position (`[x, y]`) is rejected outright, and all the position/scale tools are no-ops.

`set_param_value` was added to `src/tools/index.ts` to fix this. It accepts a number **or**
an array, clears any existing keyframes so the value is genuinely static, and returns the
value read back from Premiere:

```
set_param_value {"clipId":"...","componentName":"Motion","paramName":"Position","value":[0.5,0.1530]}
set_param_value {"clipId":"...","componentName":"Motion","paramName":"Scale","value":40}
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

The fuller set — sequence creation, bulk delete, markers, export mechanics, and every tool
behaviour verified by actually calling it — is in `knowledge/buildx/premiere-gotchas.md`.

## Useful MCP tools

`list_sequences`, `get_project_info`, `list_project_items` — orient before editing.
`import_media`, `create_sequence`, `create_bin` — setup.
`add_to_timeline` (`sourceInPoint`/`sourceOutPoint`/`insertMode`) — the core placement tool.
`razor_timeline_at_time`, `split_clip`, `trim_clip` — surgical fixes. (`ripple_delete` is
listed as a no-op in `TOOL-RELIABILITY.md` — don't reach for it until it has been tested.)
`apply_effect`, `add_transition` — treatment. `export_sequence` — delivery.
`save_project`, `undo` — safety.

Prefer assembling with `add_to_timeline` + source in/out over razor-then-delete. It is one
call per clip, it is deterministic, and it never disturbs clips already on the timeline.
