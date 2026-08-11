# HomeTour 7.25.26 — Social Shorts Build (HANDOFF)

> **Most recent project record.** This documents the **HomeTour 7.25.26** project on
> `/Volumes/BuildX-Media`, last updated 2026-07-29. It supersedes **`HANDOFF.md`**
> (2026-07-27), which covers an earlier project on a different volume.
>
> Sections are ordered **newest first** — the top of this file is the current state; content
> further down is a dated historical log and may describe conditions that no longer hold.
>
> **Whether this job is fully closed is not recorded here** — outstanding items are listed
> below. Confirm before assuming the work is finished.
>
> The MCP bridge follows whatever project is frontmost in Premiere. **Confirm with
> `get_project_info` before any build step.** Permanent BuildX knowledge is in
> `knowledge/buildx/`.

## 📦 2026-07-29 — DELIVERED: 20 shorts exported + 20 transcripts

`exports/shorts/` — 20 `.mp4` + 20 `.md` + `_manifest.json`. **6.99 GB total.**
Every duration verified against the timeline span (all within 0.02s). Zero problems.

- Format: **1728×3072, 59.94fps, H.264 + AAC**, Match Source – High bitrate (~79 Mbps).
  Preset: `…/Adobe Premiere Pro 2026.app/Contents/MediaIO/systempresets/4E49434B_48323634/01 - Match Source - High bitrate.epr`
- Each file is one complete short **including its CTA**.
- Transcripts are per-short, timestamped relative to that short's own start.

**How exporting works here:** `export_sequence` requires an absolute `presetPath` to a `.epr` —
it rejects format names like "mp4"/"h264". It queues to **Adobe Media Encoder**, which must be
running, and renders **asynchronously**. Use `range: "inout"` with `set_sequence_in_out_points`
per short, and export **strictly sequentially**, waiting for each file to stop growing — queuing
several at once risks every job picking up the last in/out points.
Script: `scratchpad/export-shorts.mjs`; transcripts: `scratchpad/make-transcripts.mjs`.
Note `list_sequence_tracks` does **not** return source in/out — use `get_clip_at_position`.

## ✅ 2026-07-29 — GRAPHICS COMPLETE, SEQUENCE VERIFIED

All the "UNFINISHED" items below are **done**. Current verified state:

- 20 shorts · 20 CTA cards · 20 logos · 20 coloured span markers, **0 misaligned**
- **No overlaps on V1, V2 or V3.** Timeline 795.7s (13.3 min). Master untouched (32 clips).
- 9 clips on V2: 8 graphics + Tom's own b-roll (`DJI_0277.MOV` at 3.654).
- **Every graphic reveal — 8 primary and 10 secondary beats — lands on or after the spoken word.**
  Audit method: map phrase → source time via `.words.json`, then
  `clip.start + (src - clip.inPoint)`, and compare against graphic start + its GSAP offset.

Current graphic versions on the timeline (older `_ProRes4444` items remain in the bin unused):

| Clip | Span | Note |
|---|---|---|
| `ht-g1-price` | 7.241–12.729 | moved +0.52s; number now lands exactly on "$440,000" |
| `ht-g7-floorplan` | 12.746–18.335 | vector rebuild of the Rainis plan, rooms reveal in sequence |
| `ht-g8-checklist-v2` | 32.799–44.595 | items fully hidden until spoken (was leaking at 18% opacity) |
| `ht-g2-payments-v2` | 213.630–226.126 | $25K row retimed 5.72 → 6.53 |
| `ht-g6-45k` | 240.457–245.946 | unchanged |
| `ht-g4-timeline-v2` | 440.223–448.081 | permits line 2.10 → 4.20; tail trimmed to land on the CTA cut |
| `ht-g3-fourofsix-v3` | 464.331–472.822 | "80%" retimed 0.80 → 5.55 |
| `ht-g5-sixseven` | 682.866–688.354 | unchanged |

Also fixed: **short 1's logo had been lost** in yesterday's head-extension — restored on V3
(0–19.720, Position `[0.5, 0.0385417]`, Scale 86.4).

**Still outstanding and NOT mine:** Tom's b-roll pass (started) and captions. Nothing exported.

---

## ⏸ PAUSED 2026-07-28 — resolved, kept for the record

**Sequence:** `BuildX Shorts — HomeTour 7.25.26` · id `bb37f25d-a828-4d78-a61d-5f51e9ce7c4d`
**Graphics bin:** `HT Shorts Graphics` · id `000f4323`

Done: 20 shorts built (dialogue → CTA, logo on V3), 20 coloured span markers verified aligned,
Tom's LUT applied by him, 8 graphics rendered and placed on V2 and filed in the bin.
Tom is doing b-roll and captions himself. **Nothing has been exported — do not export until he says.**

### ⚠️ UNFINISHED — three graphics are re-rendered but NOT re-placed

Tom asked that no graphic reveal information before he says it. Three were revealing early and
were **re-rendered with corrected timing**, but they were written to the **same filenames**, and
Tom then asked for **new names** so Premiere doesn't serve cached media. That rename never happened.

| Graphic | What changed | Old dur → new dur |
|---|---|---|
| `ht-g8-checklist` | items were visible at 18% opacity before being spoken — now fully hidden until each is said | 11.8 (same) |
| `ht-g3-fourofsix` | "80%" appeared at +0.80s but he says it at +4.69s | 5.5 → **7.6** |
| `ht-g4-timeline` | "+4 months for permits" appeared at +2.10s but he says it at +4.20s | 7.8 → **8.6** |

**To finish:**
1. Re-render each to a **new filename** (e.g. `ht-g8-checklist-v2`) — the compositions on disk are
   already corrected, just `render-graphic.mjs … --name <new>`.
2. Import, `move_item_to_bin` with **`targetBinId: "000f4323"`**, remove the old clip from V2 and
   place the new one. **g3 and g4 are longer now**, so the old timeline clips are the wrong length.
3. Also still early: **`ht-g1-price`** starts 6.723 but he doesn't say "$440,000" until **7.56**
   (headline animates at +0.32, so move the clip to **7.24**). Then push `ht-g7-floorplan` from
   12.246 to **12.75** so they don't collide — he says "900 square foot" at 11.86, so that is
   still safely after the announcement.
4. Re-check `ht-g2-payments`, `ht-g6-45k`, `ht-g5-sixseven` against the same rule (audit script
   pattern is in the session scratchpad — map phrase → source time → `clip.start + (src - clip.inPoint)`).

### Other open items

- **Gap between shorts 1 and 2 is 0s** (all others are 5.005s, one is 8.392s). Caused by
  `remove_from_timeline` rippling when short 1's head was extended. Cosmetic — markers still
  define every boundary correctly. Restoring it means shifting 19 shorts right by 5s.
- **Short 1's head was extended** to source 165.90 (was 166.450) so the full "$150,000" is heard;
  the larger whisper model confirmed the phrase starts earlier than `small.en` reported.
  Anything before ~166.5 is Buz slating the take ("Oh and I'm going to do this one") — do not
  extend further.
- **Three picks still need Tom's ear** before captioning — shorts 12, 15 and 20 have Whisper
  garbles inside the quoted lines (see `SHORTS-PLAN.md` open flags).
- Short 2 was hand-trimmed by Tom — **leave it as is**.


Started 2026-07-28. Analysis phase COMPLETE, build phase NOT started.
Read this plus `CLAUDE.md` and `TOOL-RELIABILITY.md` before continuing.

## The brief

Turn the HomeTour 7.25.26 project into **15–20 publish-ready vertical shorts** in **one new
sequence**, shorts in ranked order, generous spacing between each, a **named timeline marker**
at the start of every short, and the **standard BuildX CTA + logo animation** ending every one.
Graphics only where they add clarity or retention. Hooks in the first 3 seconds; reorder
dialogue where it makes a stronger open. **Only ever use exact spoken dialogue — never invent a
line.**

Tom's constraint, verbatim: *"We're pulling it from the project titled HomeTour 7.25.26, nothing
else."* Everything needed is inside that project — do not import from other shoots.

## Target project (bridge must be pointed at it)

| | |
|---|---|
| Project | `/Volumes/BuildX-Media/Media/Hometour/hometour sat 7.25.2026/Project/HomeTour 7.25.26.prproj` |
| Existing sequence | `Master` — id `79cd3270-8a2b-4ea3-ac17-1d7f9dc43b17` |
| Sequence format | **1728×3072 (9:16), 59.94fps** (timebase 4237833600) |
| Master contents | the 16 source clips laid end to end on V1/A1, 3638s total |

**The MCP bridge follows whatever project is frontmost in Premiere.** It silently switched from
the JulieT project to this one mid-session and nearly caused work in the wrong project. Call
`get_project_info` and confirm the name before every build step.

## Source footage

`/Volumes/BuildX-Media/Media/Hometour/hometour sat 7.25.2026/Buz Walk around/` — 16 `DJI_*.MP4`.

Despite the `DJI_` prefix these are **not drone clips** — it is a gimbal camera on Buz with a
lapel mic. Audio is clean throughout. Native 9:16 1728×3072 @ 59.94fps, so **no reframing needed**.

Two clips are too short to use: `..._0060_D` (3.0s) and `..._0065_D` (5.2s).
The big one is `..._0069_D` — 1208s / 16GB.

### Production notes that affect every short

- **Footage is flat / ungraded.** Every frame carries a grey veil (log-ish profile). Shorts will
  look washed next to competitors. Apply one Lumetri contrast/saturation pass across all clips.
- **Whisper did not diarise.** Buz and customers are unlabelled, and some passages collapsed into
  100-second single "lines". Use the `.words.json` files for exact in/out points; do not trust
  the `.md` line boundaries for cutting.
- **Verify every pick against the actual video before committing it** — Buz is sometimes in
  profile, back-to-lens, or blocked by a customer. `export_frame` is the fastest check.

## Assets already in the project (reuse — do not rebuild)

| Asset | Project item id | Notes |
|---|---|---|
| `CTA Graphics 9x16.mp4` | `000f4265` | `~/Desktop/CTA Graphics 9x16.mp4` — **5.00s, 1080×1920**, fully revealed by ~3.7s. Needs **~160% scale** in a 1728×3072 sequence. Content: ADU HOME TOURS / Walk through a finished BuildX ADU / EVERY WEEKEND 11AM–1PM / FOLLOW THE LINK FOR CURRENT LOCATIONS / BuildX.com |
| `BuildX Logo WHITE.PNG.png` | `000f4264` | Standing rule: logo on **V3** every edit. The x540/y74/54% figures in CLAUDE.md are for a **1080×1920** sequence — **recompute for 1728×3072** before applying. |

## Transcripts (DONE — 14 files, do not re-run)

`transcripts/DJI_*.md` + `.words.json`.
Generated with `scripts/transcribe.mjs` (whisper small.en). Line prefixes are `[start-end]` in
seconds, relative to that clip.

## Confirmed strong candidates (verified quotes, from transcripts I read directly)

All quotes below are **verbatim from the transcripts**. Timecodes are seconds within that clip.

| # | Hook / topic | Clip | Time | Type |
|---|---|---|---|---|
| 1 | Why a covered porch legally isn't square footage — *"it does not count towards the gross floor area because it's not heated and not [enclosed]"* | 0067 | full 0–58 | Regulation · **piece to camera**, ends "just build baby" |
| 2 | ⭐ *"whatever you build, don't build it bigger than 900 square feet and position it so later on you can build a primary house … at 1,800 square feet, and then that becomes the ADU"* | 0062 | 181.8–206.0 | Strategy — best non-obvious insight found |
| 3 | *"This was 440 460 … That includes the septic the survey the tree clearing … Final clean move[-in] and we do everything except tuck tuck you into bed"* | 0068 | 208.7–237.6 | Cost + humour |
| 4 | *"I still have to put the kitchen in, I still have to put the septic system … You're really just paying for a slice of the building."* | 0069 | ~300–312 | Cost logic |
| 5 | *"Why leave 100 square feet behind?"* … *"you'll enjoy that house a lot more at 900 than you will at 800"* | 0069 | ~312–332 | Misconception |
| 6 | First X-9 tour + multigenerational: *"the parents of the daughter are moving in here and the daughter and the son-in-law and the two little kids live over there … they currently live in Long Island"* | 0063 | full 0–75 | Story · **piece to camera**, ends "just build baby" |
| 7 | Garage under an ADU: *"garage is allowed anywhere underneath"* / *"we absolutely can"* | 0061 | ~195–215 | Regulation |
| 8 | What happens after you sign: *"first we have a pre contract signing … we sit for an hour [and a] half and go through everything one last time"* | 0061 | 238.0–302.9 | Process |
| 9 | *"I got the flyer in the mailbox the other day … they built one right up the street, I didn't even know!"* | 0066 | 14–24 | Social proof |
| 10 | Killing the 2nd bedroom to open the kitchen: *"by eliminating the second bedroom, which is normally here, that really opens this up"* | 0062 | 122.6–146.7 | Design |
| 11 | *"We probably had four or five different versions that we went through"* / *"everything gets customized"* | 0062 | 133.9–146.7 | Authority |

Also noted: the **"Remember, just build baby"** signoff is the established outro and appears in
the piece-to-camera clips (0063, 0067) — use it as the natural end beat before the CTA.

### Full candidate pool — see `SHORTS-CANDIDATES.md`

Mining is **DONE** for 13 of 14 clips. **63 candidates**, tiered A/B/C with verbatim quotes and
timecodes, are in `SHORTS-CANDIDATES.md`. Do not re-run that mining.

Only remaining gap: **`DJI_20260725131018_0075_D` (188.8s) has not been mined** — it finished
transcribing after the miners were dispatched.

Standouts to build first: the condo-ownership reveal (*"Zoning and permits are one thing, but
they can't dictate ownership"*), the never-build-under-900 strategy, the "slice of the building"
cost logic, the $20k/$25k/$45k payment schedule, and the wheelchair-accessibility customer story.

## Style / branding conventions

From `~/.claude/.../memory/buildx-graphics-conventions.md`:

- Tokens `--gold:#D9A441; --black:#0B0B0B`. Fonts **Anton** (display, uppercase) + **Archivo** 500/700.
- Chassis: gold eyebrow (28–32px, 8px letter-spacing) → Anton headline → content → gold kicker
  "BuildX. Just build baby."
- `<em>` means **gold**, never italic.
- Over b-roll, **do not** put text on a solid card — bake a full-frame semi-transparent black
  wash into the graphic (Tom's reference is a Black Video layer at 86%) so footage reads through.
- Transparent background for ProRes 4444 alpha.
- File every generated graphic into a single Premiere bin via `move_item_to_bin` — passing
  `binName` to `import_media` does not reliably file them.

## Skills to use for the build

`rough-cut`, `graphic-to-premiere`, `premiere-pro-mcp`, `claude-video-editor:hormozi-captions`
(captions are essential here — the audio is conversational), `claude-video-editor:hyperframes`.

## Tool gotchas confirmed live this session

- `add_tracks` **no-ops** with a "can block CEP execution" note. Use **`add_track`** one at a
  time — it returns real before/after counts.
- `remove_from_timeline` works but reports `deleteMode: "ripple"` even when passed
  `ripple: false`. It did **not** actually ripple (all downstream start times verified unchanged)
  — but re-verify with `list_sequence_tracks` after every removal.
- `export_frame` is real and is the only trustworthy proof an overlay landed. It **appends its
  own extension** (`foo` → `foo.png`).
- `scripts/render-graphic.mjs` had `Number()` in its arg parser which turned rational frame rates
  into `NaN`. **Fixed this session** — rationals now pass through as strings. Render graphics for
  this sequence at `--fps 60000/1001`.
- `add_to_timeline` floors `sourceOutPoint`, so a clip lands ~1 frame short. Add half a frame to
  the out point if exact length matters.
- Per `TOOL-RELIABILITY.md`, 97 of 281 tools return `success: true` while doing nothing. A
  response with `"accepted": true` and "Expanded tool dispatched…" means **nothing happened**.

### Found while building the shorts sequence (2026-07-28)

- **`create_sequence` ignores `projectItemId`** — it always makes a 1080×1920 / 30fps sequence,
  and `set_sequence_resolution` + `set_sequence_frame_rate` are both no-ops, so you cannot fix it
  afterwards. `create_sequence_from_clips` and `create_sequence_from_preset` are no-ops too.
  **The way to get a correctly-formatted sequence is `duplicate_sequence` off one that already has
  the settings, then empty the copy.**
- **`remove_selected_clips` / `select_all_clips` bulk delete is unavailable** ("Premiere menu
  command APIs are unavailable in this CEP ExtendScript context"). Loop `remove_from_timeline`
  per clip instead — and note video removal does **not** take its linked audio, so remove audio
  separately with `trackType: "audio"`.
- **`move_item_to_bin` takes `targetBinId`** — not `binId`, not `binName`. Passing the wrong key
  fails the schema, so check `success` rather than assuming it filed.
- **`list_markers` works. `get_sequence_markers`, `get_sequence_markers_by_type` and
  `get_full_sequence_info` do not** — the first returns 0, the others return stubs. `list_markers`
  returns real ids/names/comments/durations, which is also the only way to get ids for
  `delete_marker`.
- **`add_marker` supports `color` (colour name string) and `duration` (span markers).**
  `update_marker` can change name/comment/colour but **not** duration — to change a span you must
  delete and re-add.
- **Markers DO ripple with clips.** After an edit shifted shorts 3-14 left by 3.387s, the markers
  moved with them and stayed aligned.
- **`evaluate_expression` only resolves property paths** — `app.project.activeSequence.name` works,
  `1+1` and any `(function(){…})()` return `{type:"undefined"}`. It cannot be used to mutate.
- **`export_frame` is NOT reliable for arbitrary times here.** It returned stale/incorrect frames
  for two of three probes on this sequence while `get_clip_at_position` confirmed the timeline was
  correct. Verify structure with `list_sequence_tracks` / `get_clip_at_position`, not stills.

## Suggested next steps

1. Confirm the bridge is live and `get_project_info` says `HomeTour 7.25.26.prproj`.
2. Re-run the transcript mining (0069, 0064, 0070, 0071, 0072, 0073, 0074, **0075**).
3. Merge with the 11 confirmed candidates above; dedupe topics; rank 15–20.
4. Spot-check each pick with `export_frame` — kill anything where Buz is blocked or back-to-lens.
5. Present the full clip plan (hook / script map / trim notes / b-roll cues / titles) to Tom
   **before** building — he has not yet approved a clip list.
6. Build: new sequence, `plan-cut.mjs` for placements (never hand-compute offsets), Lumetri grade,
   captions, CTA + logo per short, named markers, spacing.
