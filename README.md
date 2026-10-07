# Claude Video Editor

Prompt-driven editing in Adobe Premiere Pro 2026. Claude transcribes footage, decides the
cuts, builds motion graphics as HTML, and assembles everything on a real timeline.

## Start a session

**Every time, before asking Claude to touch Premiere:**

1. Open Premiere Pro with your project.
2. `Window > Extensions > MCP Bridge (CEP)`
3. Temp directory: `/tmp/premiere-mcp-bridge`
4. Click **Start Bridge**.

Without this, Premiere tool calls hang. It is the single most common failure.

**Then, before any build step, confirm the sequence format:**

```bash
node scripts/check-sequence.mjs
```

It exits non-zero on anything that is not 29.97 / 1080×1920 and refuses to continue.
A 30 fps timeline against 29.97 source drifts invisibly until playback, and the MCP
tools that claim to fix frame rate and resolution are no-ops.

Then open this folder in Claude and prompt in plain language:

> Rough cut `/path/to/raw.mp4` and put it on the timeline. Cut it hard — only the essential parts.

> Make a lower third that says "Tom Martell / Project Manager" — stepped 8fps feel, warm
> paper texture, gold accent. Put it over the clip at 00:12.

## What's here

| Path | |
|---|---|
| `CLAUDE.md` | How the system works — the operating manual Claude reads |
| `knowledge/buildx/` | Permanent BuildX knowledge — brand, voice, editorial and production standards |
| `TOOL-RELIABILITY.md` | Which MCP tools actually work — 97 of 281 fake success |
| `scripts/transcribe.mjs` | Footage → word-level transcript (whisper.cpp) |
| `scripts/transcribe-x.mjs` | Footage → word-level transcript (WhisperX, forced alignment + VAD) |
| `scripts/plan-cut.mjs` | Keep-ranges → exact timeline placements, and optional FCP7 XML |
| `scripts/check-sequence.mjs` | **Run first.** Hard-fails if the sequence is not 29.97 / 1080×1920 |
| `scripts/new-project.mjs` | New project from the vertical template, `X#### (surname)` |
| `scripts/detect-scenes.mjs` | Video → shot list with timecodes |
| `scripts/reframe-vertical.mjs` | Horizontal footage → 1080×1920 master in `reframed/` |
| `scripts/prep-audio.mjs` | Audio prepared for transcription only — never for the edit |
| `scripts/render-graphic.mjs` | HyperFrames composition → ProRes 4444 / MP4 |
| `scripts/mcp-call.mjs` | Call any Premiere tool from the shell (bridge testing) |
| `scripts/audit-tools.mjs` | Regenerate `TOOL-RELIABILITY.md` |
| `graphics/alpha-test/` | Working transparent lower-third, use as a template |
| `gui/` | Computer-use runbooks — the four GUI-only operations, and the evidence log |
| `mcp/premiere-pro-mcp/` | The MCP server + CEP bridge |
| `mcp/premiere-pro-mcp/src/telemetry/` | Performance telemetry — how long an edit took and how much of it was human |
| `mcp/premiere-pro-mcp/src/qa/` | Automated QA — verifies an edit actually landed, and applies safe fixes |
| `mcp/premiere-pro-mcp/scripts/telemetry-report.mjs` | Read performance reports from the shell |
| `presets/` | Audio and colour treatment notes |
| `graphics-template/` | Shared brand tokens + parameterised lower third, question card and end card (see `graphics-template/README.md`) |
| `knowledge/INDEX.md` | One-page index of every knowledge file the MCP can read — the MCP checks it first |
| `private/` | **Gitignored.** Video library, b-roll index, private notes, models. Never committed — the repo is public |
| `scripts/library-*.mjs` | Build and update the private video library (exports, transcripts, YouTube Studio numbers) |
| `scripts/find-cuts.mjs` · `broll-tag.mjs` · `loudness.mjs` · `platform-export.mjs` · `weekly-report.mjs` | Shell versions of the editing, audio, export and reporting tools below |
| `scripts/graphic-from-template.mjs` | New graphic from a `graphics-template/` template |
| `scripts/cover-frames.py` | Thumbnail candidate scoring (OpenCV + YuNet) |

## BuildX feature upgrades (v3)

Twenty additions on top of the Premiere bridge, built 2026-10-06/07. Everything that edits
the timeline or writes a file is **opt-in and reviewable**: suggestion tools write a
`<name>.<kind>.md` review sheet beside the transcript with nothing approved, and only the ids
you approve are applied. Nothing overwrites an existing file. Nothing is "approved" — every
export is still proof-watched in Premiere first.

### Setup

- **Private data** lives in `private/` (gitignored), or wherever `BUILDX_PRIVATE_DIR` points.
  Set it on the MCP server if you keep it elsewhere:
  ```bash
  claude mcp remove premiere_pro -s user
  claude mcp add premiere_pro -s user -e PREMIERE_TEMP_DIR=/tmp/premiere-mcp-bridge \
    -e BUILDX_PRIVATE_DIR=/path/to/private -- node "$PWD/mcp/premiere-pro-mcp/dist/index.js"
  ```
- **ffmpeg / ffprobe** on PATH (loudness, platform versions, safe zones).
- **Cover frames** need OpenCV Python and the YuNet face model. Defaults: the PySceneDetect uv
  tool's Python and `private/models/yunet.onnx`; override with `BUILDX_CV_PYTHON` and
  `BUILDX_FACE_MODEL`.
- **WhisperX** transcripts (`scripts/transcribe-x.mjs`) feed every transcript-driven tool.
- After pulling: `cd mcp/premiere-pro-mcp && npm run build`.

### What was added

| Area | Tool / script | What it does |
|---|---|---|
| **Library** | `scripts/library-add.mjs`, `library-import-transcripts.mjs` | One private JSON entry per finished video (hook, length, cuts, graphics, captions, links, numbers). Schema: `knowledge/library/video-entry.schema.json` |
| | `find_similar_videos` | The 3–5 most similar past videos for a new transcript or topic |
| | `list_hooks` · `check_hook` · `scripts/library-import-youtube.mjs` | Past hooks ranked by retention / stayed-to-watch (from a YouTube Studio CSV); warns when a new hook is too close to one already posted or queued |
| | `knowledge/INDEX.md` · resource `buildx://knowledge/index` | What each knowledge file is for; open any with `buildx://knowledge/file/<path>` or `buildx://private/knowledge/<path>` |
| **Editing** | `find_cuts` · `scripts/find-cuts.mjs` | *Optional.* Pauses and fillers from WhisperX timings → a cut list; the first build always keeps the full take |
| | `suggest_punch_ins` · `apply_punch_ins` | *Optional.* Eased 110% pushes on numbers, stakes words and sentence starts |
| | `scripts/broll-tag.mjs` · `suggest_broll` | *Optional.* Private tag index of the b-roll library (names + optional look-and-tag); clips suggested per phrase, flagged clips left out |
| | `find_short_candidates` · `build_short_sequences` | Podcast → shorts: ranked 30–60 s windows, then 1080×1920 29.97 sequences for approved ids (logo + end card, no export) |
| **Captions & graphics** | `make_captions` · `place_captions` | Single-line cues fitted by measured Poppins Bold 75 width, never overlapping, off frame 0; SRT + review sheet; caption track placed by script (Thomas Default is still one GUI click) |
| | `graphics-template/` · `scripts/graphic-from-template.mjs` | Brand tokens + lower third, question card and the standard end card (wording fixed) at 9:16 or 16:9 |
| | `check_safe_zones` | Flags graphics and captions in the Shorts / TikTok / Reels UI zones, measured by visible pixels |
| **Audio** | `measure_loudness` · `normalize_loudness` · `scripts/loudness.mjs` | −14 LUFS / −1 dBTP by gain + true-peak limiter, measured before and after; writes `<name>-14LUFS.<ext>` |
| | `plan_ducking` · `apply_ducking` | *Optional, not for shorts.* Music bed −18 dB in gaps, −30 dB under speech |
| **Export & publishing** | `export_platform_versions` · `scripts/platform-export.mjs` | YouTube Shorts / Reels / TikTok MP4s in `Platform Versions/`, loudness-normalised, under 480 MB |
| | `pick_cover_frames` | Five thumbnail candidates (face, sharpness, contrast, eyes open) in `Cover Candidates/` |
| | `upload_metadata_brief` · `save_upload_metadata` | Title, description and hashtags per platform; checked for limits, invented figures, "drywall" and calls to action before saving |
| **QA & reporting** | `export_with_gate` | Technical QA + safe zones before render (blocks on failure; override needs a reason, recorded), loudness + black frames after |
| | `get_weekly_report` · `scripts/weekly-report.mjs` | Shorts made, time per stage, failing tools, QA blocks and overrides — and what was not recorded |

`export_frame` now lands on the exact requested frame and returns the real file path.

## Performance Telemetry

Every editing session is timed automatically, so the question *how much human time did
this actually take* has an answer that is measured rather than remembered.

### The measurement principle

Three quantities, tracked separately, never derived from one another:

| | |
|---|---|
| **Total elapsed time** | Wall clock, session start to session finish |
| **Automated processing time** | Machine work — transcription, analysis, cut planning, Premiere operations, rendering, automated QA |
| **Human active time** | You actually working — prompting, reviewing, approving, correcting, driving Premiere by hand |

**Automated processing time is never counted as human labour.** A 30-minute export that
runs while you make coffee is 30 minutes of automated processing and zero minutes of human
time. This is the whole point of the system: the eventual output is real human time saved.

Overlapping spans are **merged, not summed**, so two operations running at once cannot push
a total past the wall clock.

### What is tracked

Automatically, with no tool call from you:

- MCP tool calls, successes, failures, timeouts
- Retries — a repeat call of a tool that just failed is recognised as a retry
- Per-operation duration and category
- Responses carrying the expanded dispatcher's `accepted: true` stub signature, flagged in
  the operation's metadata (see `TOOL-RELIABILITY.md`)

Explicitly, because a machine cannot infer them:

- Human active time (`start_human_activity` / `stop_human_activity`)
- Manual corrections and why (`record_manual_correction`)
- GUI fallbacks (`record_gui_fallback`)
- QA checks and failures (`record_qa_check`)
- Workflow stages (`start_workflow_stage` / `end_workflow_stage`)

### Where the data lives

```
mcp/premiere-pro-mcp/data/telemetry.sqlite        the store
mcp/premiere-pro-mcp/data/telemetry.config.json   local settings
```

SQLite, created automatically on first use, **local only**. Nothing is sent anywhere —
no analytics provider, no cloud, no network call of any kind. The directory is gitignored.

The store uses `node:sqlite`, the runtime's built-in driver, so telemetry adds **no npm
dependency and no native build**. It needs Node 22.5 or newer (this machine runs 26). On an
older runtime telemetry reports itself unavailable and every call becomes a no-op.

### How sessions work

A session is one production workflow.

```
start_telemetry_session  {"projectName":"BuildX Podcast Episode 14",
                          "workflowType":"podcast_short",
                          "baselineHumanMinutes":83}
...
end_telemetry_session    {"status":"success"}
```

Session ids look like `buildx_2026-08-24_001`. If an instrumented tool runs before you have
started a session, an unattributed one is opened so nothing is lost; calling
`start_telemetry_session` afterwards **adopts and renames it** rather than leaving an orphan.

### How human activity is tracked

Human time has to be marked, because it cannot be inferred:

```
start_human_activity   {"reason":"choosing which lines survive"}
stop_human_activity    {}

record_manual_correction {"reason":"Adjusted lower-third position manually",
                          "durationMs":45000}

record_gui_fallback      {"operation":"caption creation",
                          "reason":"captionTracks is undefined in ExtendScript",
                          "durationMs":240000}
```

A correction with no `durationMs` is counted but adds no time. GUI fallbacks count as
**human** time, never automated — clicking is you working.

### Viewing reports

From the agent:

```
get_performance_report                     the latest session
get_performance_report  {"sessionId":"buildx_2026-08-24_001"}
get_recent_performance  {"limit":10}       the last 10 edits
get_monthly_performance {"month":"2026-08"}
```

From the shell (needs `npm run build` first):

```bash
cd mcp/premiere-pro-mcp
npm run telemetry                       # last session report
node scripts/telemetry-report.mjs recent 10
node scripts/telemetry-report.mjs month 2026-08
node scripts/telemetry-report.mjs session buildx_2026-08-24_001
node scripts/telemetry-report.mjs where # database path and session count
```

### Baseline time and what the ROI figure means

A session can carry `baselineHumanMinutes` — how long this workflow used to take by hand.
Supply it at session start, or later with `set_session_baseline`. When a baseline exists the
report adds human time saved and the reduction percentage. **Without a baseline the whole
section is omitted rather than guessed.**

Configure an hourly labour cost to also get a money figure. It is never hardcoded:

```
configure_telemetry {"hourlyLaborCost": 65, "currency": "$"}
```

The figure is labelled **estimated labor-equivalent capacity recovered** — hours saved ×
hourly cost. That is capacity freed up, **not direct cash savings**: no cheque is written
because an edit finished sooner. Read it as "this much labour capacity became available for
other work".

### Turning telemetry off

Any of these:

```bash
BUILDX_TELEMETRY_DISABLED=1 node dist/index.js     # per run
```

```
configure_telemetry {"enabled": false}             # persisted, applies next start
```

Or delete `mcp/premiere-pro-mcp/data/` to discard the history entirely.

Other environment overrides: `BUILDX_TELEMETRY_DB` (store path),
`BUILDX_TELEMETRY_HOURLY_LABOR_COST`, `BUILDX_TELEMETRY_CURRENCY`,
`BUILDX_TELEMETRY_AUTO_SESSION`.

### Telemetry never breaks an edit

It is non-critical infrastructure and is built to fail quietly. Every entry point is wrapped:
a telemetry error is recorded in the `telemetry_errors` table where possible, logged to
stderr, and swallowed. The instrumented tool call runs **outside** all telemetry error
handling, so instrumentation can neither change a tool's result nor swallow its failure. If
the store cannot be opened at all, editing proceeds with telemetry silently off.

### The fifteen telemetry tools

`start_telemetry_session`, `end_telemetry_session`, `get_telemetry_status`,
`start_workflow_stage`, `end_workflow_stage`, `start_human_activity`, `stop_human_activity`,
`record_manual_correction`, `record_qa_check`, `record_gui_fallback`, `set_session_baseline`,
`get_performance_report`, `get_recent_performance`, `get_monthly_performance`,
`configure_telemetry`.

## Automated QA

An edit is not finished because Premiere returned `success: true`. This layer verifies the
work actually landed — by reading project state back, by inspecting the exported file, or
both — and then says plainly what it could not verify.

### Result statuses

| | |
|---|---|
| **PASS** | Verified. |
| **FAIL** | An objective requirement is violated and cannot be safely corrected. |
| **AUTO_FIX** | A problem was found that is safe to correct. After the fix the check is re-run. |
| **REVIEW** | Subjective or potentially destructive. A human decides. |
| **SKIPPED** | Not applicable to this workflow, or nothing to measure. |
| **ERROR** | The check itself could not run. **Never treated as PASS.** |

### Final statuses

`READY_FOR_REVIEW` · `REVIEW_REQUIRED` · `BLOCKED` · `FAILED`

`READY_FOR_REVIEW` is the best outcome and still means *a person has not looked at it yet* —
technical QA passing is not editorial sign-off. There is deliberately no status meaning
approved, perfect or guaranteed.

`FAILED` outranks everything: if a required check could not execute, QA did not complete, and
an unfinished QA pass is not a passing one.

### The checks, and how far each is actually trusted

**VERIFIED — the underlying API returns real data**

| Check | What it reads |
|---|---|
| `sequence_resolution` | `get_sequence_settings` width/height |
| `frame_rate` | timebase, compared as an **integer**, never a float — 29.97 is 30000/1001 |
| `timeline_gaps` | per-clip start/end, measured in **whole frames** |
| `timeline_overlaps` | same, per video track |
| `timeline_duration` | latest clip end vs. an expected duration |
| `audio_presence` | audio tracks and clip durations |
| `logo_presence` | logo clip on V3, and unbroken coverage to the end card |
| `logo_safe_zone` | Motion Position/Scale read back, against the geometry in `knowledge/buildx/safe-zones.md` |
| `graphics_presence` | required graphics on the timeline |
| `end_card` | present, last, and ~5.00s |
| `export_file` | the file exists, is big enough, is readable by ffprobe, and its duration and resolution match |
| `export_black_frames` | ffmpeg `blackdetect` on the render |
| `export_audio_levels` | ffmpeg `volumedetect` — silence and clipping only |

**EXPERIMENTAL**

- `captions` — only a **burned-in caption overlay clip** can be found. Present and in bounds
  is all it can say; it cannot read the words or where they sit.
- `visual_frames` — frames are extracted and screened. Objective black detection is solid;
  everything else comes back as REVIEW.

**UNAVAILABLE — no API exists, and none is faked**

- **Premiere caption tracks.** `app.project.activeSequence.captionTracks` returns `undefined`
  in ExtendScript — probed live 2026-08-18. Caption tracks cannot be created, listed or read.
  The check reports SKIPPED with that reason. It never invents a pass.

### Visual QA, honestly described

Visual QA extracts representative frames (start, 10%, 25%, 50%, 75%, 90%, end) and screens
them for the one thing a machine can decide alone: whether a frame is simply black. The
threshold is **measured, not assumed** — H.264 in yuv420p is limited-range, so true black
reads as luma 16, a genuinely dark shot reads ~25, and ordinary content reads ~126. The line
sits at 20.

Everything else on the visual list — a lower third covering a face, a badly framed crop, a
malformed graphic — is returned as **REVIEW with the frame paths attached**, for a person or
a multimodal agent to look at. Visual QA never changes the edit.

Frames come from the **exported file via ffmpeg** wherever one exists. Premiere's own
`export_frame` is only a fallback, and the check says so in its detail line when used: it is
reliable for confirming a static overlay, and documented unreliable at arbitrary times on a
long sequence.

### Safe auto-fix policy

A fix runs only when the problem is objective, the correction is deterministic, the change is
small and reversible, and the rule comes from BuildX knowledge rather than being invented.

**Implemented:**

| Fix | What it does |
|---|---|
| `fix_logo_safe_zone` | Moves the logo the **smallest distance** that brings it inside the safe zone. Scale is never changed. |
| `fix_one_frame_gap` | Closes a gap of **exactly one frame**, the known frame-maths artefact. It first extends the previous clip one frame into the gap (`extend_clip_tail`: a real trim, linked audio included, with the handle proven from ffprobe stream durations), so nothing downstream moves. Failing that, it moves the following clip back with its audio, but only when that clip is last on its track and nothing on another track lines up with it. Otherwise it leaves the gap and says why. |

**Approved placements pass as they are.** The 1080 × 1920 shorts standard (upper-right, x858
y308, scale 31) crosses the right safe line by 41px on purpose. It is listed in
`approvedLogoPlacements` (`src/qa/config.ts`), so QA passes it, says so in the report, and
never nudges it. Any other placement that crosses a line gets the smallest nudge back inside.
The fix never snaps to a canonical position or changes scale.

**Never auto-fixed:** a missing logo or end card (importing an asset and placing a clip is
not one reversible write), gaps larger than a frame, overlaps, wrong sequence resolution or
frame rate, audio levels, caption wording, or anything editorial.

**Every fix is confirmed by reading state back.** Fixes run one at a time, and each next issue
is planned from a fresh re-run, never the first-pass snapshot: closing one gap moves edges the
next one is measured from. A fix counts as verified only when its own issue is gone and its
read-back matched. That includes the case where the tool reports success and nothing actually
changed. Attempts are capped at one per issue, twenty per run; nothing loops.

### QA score

```
required checks passed / required checks executed
```

SKIPPED checks are in neither half. Two scores are reported: **first-pass**, taken before any
repair, and **final**. The first-pass score is the interesting one — it is how often the
system produces correct work unaided.

### Workflow configuration

Different workflows need different checks. Profiles ship for `podcast_short`,
`social_vertical`, `interview_clip`, `home_tour`, `podcast_full_episode` and
`youtube_landscape` — a full episode is landscape and has no end-card requirement, a short is
1080×1920 at 29.97 and does. Nothing is forced onto every workflow.

### Running it

```
run_buildx_qa      {"sequenceId":"...","workflow":"podcast_short","exportPath":"/abs/out.mp4"}
run_technical_qa   {"sequenceId":"..."}          # objective checks only, no mutation
run_visual_qa      {"exportPath":"/abs/out.mp4"} # frame sampling only, no mutation
apply_safe_qa_fixes{"sequenceId":"..."}
rerun_failed_qa_checks {}
get_last_qa_report {}
get_qa_failures    {}
```

From the shell, against a live Premiere (bridge running):

```bash
node scripts/mcp-call.mjs run_technical_qa '{"sequenceId":"SEQ_ID"}'
```

### Disabling auto-fix

Pass `"autoFix": false` to `run_buildx_qa`, or use `run_technical_qa`, which never mutates
anything. Auto-fix can also be turned off per workflow in the profile.

### Telemetry

Every QA pass is recorded to the local telemetry store: checks executed, passed, failed,
errored and in review; auto-fixes attempted and successful; first-pass and final scores;
duration; final status; and **which checks failed**. Reports live at
`mcp/premiere-pro-mcp/data/qa/last-qa-report.json`.

### Limitations

- **Verified against a live bridge on 2026-10-06** in a sandbox project: every detection check,
  `get_param_value`, the logo nudge, and the gap fix (extend, move and decline paths), each
  confirmed by diffing the timeline frame by frame. The media half (export, black frames,
  audio, frame extraction) is verified against real ffmpeg-rendered files.
- The upper-right shorts logo (858/308, scale 31) is an **approved placement** (Thomas,
  2026-10-06). It passes despite its 41px right-edge breach, and this was verified live.
- Caption tracks cannot be read at all. Only a burned-in overlay clip is detectable.
- Safe-zone compliance for captions and lower thirds is baked into the rendered overlay;
  Premiere cannot see where text sits inside it, so that stays a visual REVIEW.
- Audio checking is a sanity check for silence and clipping, not LUFS mastering.
- `trackItem.move()` moves only the one item, and `end`/`outPoint` alone do not trim. Both
  were found live, and both are handled. See `knowledge/buildx/premiere-gotchas.md`.

## Health check

```bash
cd mcp/premiere-pro-mcp && npm run setup:doctor
```

## Requirements

Node 18+ (running 26), ffmpeg, Premiere Pro 2026. Transcription and graphics rendering run
locally — no API keys, no upload.

## Uninstall

```bash
cd mcp/premiere-pro-mcp && npm run uninstall:mac
```

Removes the CEP extension and the Claude Desktop MCP entry. Delete this folder to remove
the rest.
