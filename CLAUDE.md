# Claude Video Editor

Prompt-driven video editing: Claude cuts footage and builds motion graphics, then places
both onto a real Premiere Pro timeline.

Two engines:

- **HyperFrames** — motion graphics authored as HTML/CSS/GSAP, rendered to video.
- **Premiere Pro MCP** — 283 tools that drive Premiere Pro 2026 over a CEP bridge.

## Before you touch Premiere — READ THIS

Premiere tools fail silently-ish (they time out) unless the bridge is live. Every session:

1. Premiere Pro is open with a project loaded.
2. `Window > Extensions > MCP Bridge (CEP)` panel is open.
3. Temp directory is `/tmp/premiere-mcp-bridge`.
4. The bridge is running. It auto-starts when the panel loads (log: "Auto-starting bridge...");
   click **Start Bridge** only if someone pressed Stop.

If tool calls hang or time out, this is the cause ~90% of the time. Check the panel first,
before debugging anything else. If it looks stuck, close the panel (≡ menu → Close Panel)
and reopen it from `Window > Extensions` — there is no right-click Reload. The panel
**auto-starts** on load (since 2026-10-06), so reopening it is enough; no Start click needed.

**The bridge follows whatever project is frontmost in Premiere, and it has silently switched
projects mid-session.** Call `get_project_info` and confirm the project name before every
build step — not once at the start.

Verify the install at any time:

```bash
cd mcp/premiere-pro-mcp && npm run setup:doctor
```

## BuildX knowledge — read before starting work

Permanent BuildX knowledge lives in `knowledge/buildx/`. It is **not** loaded automatically.
**Check `knowledge/INDEX.md` first** (MCP resource `buildx://knowledge/index`): it lists every
knowledge file — tracked and private — with what it covers and when to open it, so you read only
what the task needs. Then read the relevant file before beginning the task. If multiple files
are listed, read them in the order shown.

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

## 97 of the 283 tools lie about succeeding

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

## Computer use — a scoped GUI fallback, not a general capability

Computer use (the `computer-use` MCP) drives Premiere's GUI by screenshot and click. It is the
**last-resort tier**, below the bridge and the working MCP tools. Full runbook: [`gui/SETUP.md`](gui/SETUP.md).

**The four sanctioned operations** — GUI only for the part that has no working API:

| Operation | Why |
|---|---|
| **Caption styling** | `sequence.captionTracks` is **`undefined`** in ExtendScript — verified live 2026-08-18. A caption *track* can now be placed by script (`place_captions`, which keeps cue 1 at its real time), but its Track Style (**Thomas Default**) is still one GUI click per sequence, and tracks cannot be read back |
| FCPXML import | `import_sequences` is a no-op |
| Sequence creation @ 29.97 / 1080×1920 | the four generic sequence tools are no-ops. **Short sequences cut from a master are scripted** by `build_short_sequences` (createSubsequence + settings, verified live) |
| Export / Media Encoder queueing | the generic encode tools are no-ops. `export_sequence` and `export_with_gate` (`renderMethod: "direct"` = `exportAsMediaDirect`) do render |

Plus **visual verification** — independently confirming a mutation actually happened.

**The seven hard rules:**

1. **Last resort, once per batch — never per-clip.** If an operation runs more than once per
   project, it belongs in XML or a script, not on screen.
2. **Never use computer use for what the bridge does reliably.** `set_source_in_out`,
   `overwrite_from_source`, `import_media` and the read tools work. Use them.
3. **Sandbox only** until told otherwise — `~/premiere-gui-sandbox/`, never a live
   `X#### (surname)` project.
4. **Never click** `Save As`, `Project Manager`, `Consolidate and Transcode`, `Remove Unused`,
   `Make Offline`, `Link Media`, `Render and Replace`, `Replace Footage`, or anything under
   `File > Project Settings`. If a task seems to need one — stop and ask.
5. **Never dismiss an unexpected dialog.** Screenshot it, stop, report. Do not guess at modal
   buttons.
6. **No app approvals beyond Premiere Pro and Media Encoder.** If a task appears to need Finder
   or a terminal on screen, that is the signal it should be a Bash command instead.
7. **Screenshot before and after every GUI operation**, saved to `gui/evidence/` with a timestamp.

**Two traps that cost real time** — both in `gui/SETUP.md` in full:

- The macOS TCC grant belongs to **Terminal**, the host app, not to Claude or the MCP server. Never
  "refresh" Screen Recording by toggling it off and on: the grant is bound at process start, so
  toggling off kills it until Terminal is fully quit and relaunched.
- Timecode display is **Feet + Frames (16mm)** — 40 frames per foot. Reading `29+18` as 29.6
  seconds instead of 39.3 is a 10-second error. Cross-check against
  `activeSequence.end / 254016000000`.

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

For a 1080x1920 short: **upper-right, Position `[0.79444, 0.16042]` (x858, y308), Scale 31.**
This is the house standard, confirmed by Thomas on 2026-10-06. **Values for other sequence
formats are in `knowledge/buildx/design-system.md`.**

> **It crosses the right safe line on purpose.** At scale 31 the logo's right edge lands at
> x1013, 41px past the 972 edge-safe line; the top edge (248px) clears the 192px title-safe
> band. Thomas chose this placement, so **do not "correct" it**. QA passes it as an approved
> placement and never nudges it. The older centred `[0.5, 0.1530]` / scale 40 and the
> original `0.0385417` / scale 54 (cropped off the top at −31px) are both superseded.
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
set_param_value {"clipId":"...","componentName":"Motion","paramName":"Position","value":[0.79444444,0.16041667]}
set_param_value {"clipId":"...","componentName":"Motion","paramName":"Scale","value":31}
```

`add_keyframe` was also fixed to `JSON.stringify` its value, so it now handles 2D params too.
Rebuild after changing the server: `cd mcp/premiere-pro-mcp && npm run build`.

## Exports are capped at 480 MB

`export_sequence` enforces a **480 MB** budget on every delivery. AME has no target-size
setting, so the cap is applied after the fact: the tool waits for the render (watching the
output file stop growing — there is no completion callback), measures it, and re-encodes
anything oversized with a two-pass ffmpeg bitrate derived from the file's real duration.

```
export_sequence  {"sequenceId":"...","outputPath":"/abs/out.mp4","presetPath":"/abs/p.epr"}
compress_export  {"filePath":"/abs/already-rendered.mp4"}
```

- `maxSizeMB` changes the budget; `autoCompress:false` opts out and returns as soon as AME
  has the job.
- The compressed file is written as `<name>-under480mb.mp4` **beside** the original. Pass
  `replaceOriginal:true` to swap in place — but not for anything Premiere has imported,
  which loses its media link when the file underneath it changes.
- **Alpha overlays are refused, not compressed.** `h264`/`hevc` cannot store an alpha
  channel, so re-encoding a ProRes 4444 render silently flattens it into an opaque box —
  the exact failure this repo already warns about for alpha WebM. Cap the finished edit
  instead. `allowAlphaLoss:true` overrides it if the transparency genuinely is not needed.
- `add_to_render_queue` does **not** wait or compress; it only queues. Run `compress_export`
  on its output.
- `export_sequence` now **blocks** until the render finishes. It gives up early if the file
  never appears (90s) or the render exceeds `waitTimeoutMinutes` (default 30), reporting
  `sizeCapEnforced: false` rather than pretending the cap held.

## Verify overlays visually with `export_frame`

`export_frame` is real and is the fastest way to confirm an overlay actually landed —
tool success proves nothing. It parks the playhead and exports at that exact frame (fixed
2026-10-07: it used to pass raw seconds and land on whatever frame was showing), and it returns
the real file path — `foo.png` is written as `foo.png`.

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

## Performance telemetry — start a session, mark your own time

Every tool call is timed automatically. What the machine cannot see is **you**, so two
things have to be said out loud.

**At the start of an edit:**

```
start_telemetry_session {"projectName":"X1234 (surname) — Shorts",
                         "workflowType":"podcast_short",
                         "baselineHumanMinutes":83}
```

`baselineHumanMinutes` is optional and is how long this used to take by hand. Without it the
report simply omits the time-saved comparison rather than inventing one.

**Whenever the human is actually working** — reviewing a cut, approving a graphic, fixing
something in Premiere by hand:

```
start_human_activity {"reason":"reviewing the rough cut"}
stop_human_activity  {}
```

**Automated processing time is not human labour.** A 20-minute export while nobody is
watching is machine time. If human time is never marked, the report will say the edit cost
zero human minutes — which is the one number that must not be wrong.

Also record, as they happen: `record_manual_correction` (with the reason),
`record_gui_fallback` (every computer-use operation — clicking is human time),
`record_qa_check`, and `start_workflow_stage` / `end_workflow_stage` around
transcription, analysis, cut_planning, timeline_build, graphics, qa and export.

**At the end:** `end_telemetry_session {"status":"success"}` returns the finished report.

Retries, failures, timeouts and tool counts need no calls — the dispatcher records them.
Storage is a local SQLite file at `mcp/premiere-pro-mcp/data/telemetry.sqlite`; nothing is
transmitted anywhere. Telemetry can never break an edit: if it fails, it goes quiet.

Full documentation, including the monthly report and what the ROI figure does and does not
mean, is in [README.md](README.md#performance-telemetry).

## Automated QA — run it before you say "done"

A tool call returning success is not evidence. Before reporting an edit complete, run QA:

```
run_buildx_qa {"sequenceId":"...","workflow":"podcast_short","exportPath":"/abs/out.mp4"}
```

It reads project state back and inspects the exported file, applies only fixes that are
objective and reversible, re-verifies each one by reading state again, and returns a status of
`READY_FOR_REVIEW`, `REVIEW_REQUIRED`, `BLOCKED` or `FAILED`. **There is no status meaning
approved** — the best outcome still expects a human to look.

Do not report "Done." Report what QA found:

> Edit complete. Technical QA: 12/12 passed. Visual QA: 1 review item.
> Status: REVIEW_REQUIRED.

`run_technical_qa` and `run_visual_qa` never mutate anything. `get_qa_failures` returns just
what needs attention. Full documentation, including which checks are VERIFIED, EXPERIMENTAL
and UNAVAILABLE, is in [README.md](README.md#automated-qa).

**Caption tracks cannot be checked at all** — `captionTracks` is `undefined` in ExtendScript.
QA reports that honestly rather than passing. Confirm captions visually.

**Export through the gate.** `export_with_gate` runs technical QA (and, for vertical workflows,
`check_safe_zones`) before rendering and **blocks on any failure**; `override:true` needs an
`overrideReason`, which is recorded in telemetry. After the render it checks loudness and black
frames; problems keep the file and are reported. Report its `status`, not "done".

## BuildX v3 tools — which one when

Suggestion tools write a review sheet (`<name>.<kind>.md`) beside the transcript with **nothing
approved**; apply only the ids the user picks. **The first build never uses the optional ones** —
cuts, punch-ins, b-roll and ducking run only when asked. Full list in
[README.md](README.md#buildx-feature-upgrades-v3).

| When | Use |
|---|---|
| Before editing a new piece | `find_similar_videos` (past examples), `buildx://knowledge/index` |
| Writing or picking a hook | `check_hook` (too close to a past one?), `list_hooks` |
| Long episode → shorts | `find_short_candidates`, then `build_short_sequences` for approved ids |
| Asked to tighten a take | `find_cuts` → `scripts/find-cuts.mjs --apply` → `plan-cut.mjs` |
| Asked for punch-ins / b-roll | `suggest_punch_ins` → `apply_punch_ins`; `suggest_broll` |
| Captions | `make_captions` → review the flags → `place_captions` → Thomas Default in the GUI |
| A new graphic | `scripts/graphic-from-template.mjs` (never edit `graphics/`), then `check_safe_zones` |
| Music under dialogue (longform only) | `plan_ducking` → `apply_ducking`, prove by render |
| Delivery | `export_with_gate` → `normalize_loudness` if flagged → `export_platform_versions` → `pick_cover_frames` → `upload_metadata_brief` + `save_upload_metadata` |
| End of week | `get_weekly_report` |

Private data (library, b-roll index, private notes, models) lives in `private/` or
`$BUILDX_PRIVATE_DIR` and is **never committed — the repo is public.** Keep customer names,
addresses and transcripts of unreleased videos out of tracked files, test fixtures included.

## Useful MCP tools

`list_sequences`, `get_project_info`, `list_project_items` — orient before editing.
`import_media`, `create_sequence`, `create_bin` — setup.
`add_to_timeline` (`sourceInPoint`/`sourceOutPoint`/`insertMode`) — the core placement tool.
`razor_timeline_at_time`, `split_clip`, `trim_clip` — surgical fixes. (`ripple_delete` is
listed as a no-op in `TOOL-RELIABILITY.md` — don't reach for it until it has been tested.)
`apply_effect`, `add_transition` — treatment. `export_with_gate` (or `export_sequence`) — delivery.
`save_project`, `undo` — safety.

Prefer assembling with `add_to_timeline` + source in/out over razor-then-delete. It is one
call per clip, it is deterministic, and it never disturbs clips already on the timeline.
