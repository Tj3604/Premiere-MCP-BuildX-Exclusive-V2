---
status: current
verified: 2026-07-30
source-of-truth: mixed
---

# Production Workflow

Defines the complete BuildX production process — how a project actually gets made, from raw
footage to published files. **This is process, not API reference.** Commands and tool syntax
live in `CLAUDE.md`; tool behaviour and failures live in `premiere-gotchas.md`.

**Source-of-truth: mixed.**

- **Authoritative** — the QA checklist, the graphic-timing audit method, and the publishing
  handoff. None of this exists anywhere else in the repository.
- **Mirror** — workflow shapes summarised from `CLAUDE.md`. Marked inline.
- **Pointer** — every command, flag and script invocation. Follow the link rather than
  copying syntax here, so this file cannot drift out of step with the scripts.

---

## Before anything else

Two checks, every session, in this order. Skipping either has cost real work.

**1. Is the bridge running?**
Premiere open → `Window > Extensions > MCP Bridge (CEP)` → temp dir
`/tmp/premiere-mcp-bridge` → **Start Bridge**. Without it, every Premiere tool call hangs.
Full procedure in `CLAUDE.md`.

**2. Is the right project frontmost?**
**The bridge follows whatever project is frontmost in Premiere, and it has silently switched
projects mid-session.** Call `get_project_info` and confirm the project name **before every
build step**, not just at the start. See `premiere-gotchas.md`.

---

## 1 · Transcript workflow

Transcription produces two files per source clip: a readable `.md` and a word-level
`.words.json`.

| File | Use |
|---|---|
| `<name>.md` | **Reading and selection.** Line prefixes are `[start-end]` in seconds, relative to that clip. |
| `<name>.words.json` | **Cutting.** The only trustworthy source of in/out points. |

### Rules

- **Never cut from the `.md` line boundaries.** Whisper does not diarise, and some passages
  collapse several speakers into a single 100-second "line." The `.md` is a script to read,
  not a timing source.
- **Escalate the model when a boundary matters.** A smaller model mis-reported the start of
  a spoken phrase; a larger model located it correctly, and the clip had to be re-trimmed
  afterwards. If a cut depends on exactly where a phrase begins, verify with a larger model
  before building on it.
- **Do not re-transcribe what already exists.** Transcription is the most expensive step in
  the pipeline — tens of gigabytes read off the media server for an hour of footage. Check
  `transcripts/` first.
- Transcription is deterministic and local. No upload, no API key.
- `transcripts/` is gitignored — a clone will not have it.

*Command syntax: `CLAUDE.md`, Workflow 1. Speaker labelling: `people.md`. Known
mis-transcriptions: `terminology.md`.*

---

## 2 · Shorts workflow

The process that produced the shipped batch. Stages 1–7 are analysis; nothing is built until
the list is approved.

### Analysis

1. **Confirm the project** — `get_project_info`. See above.
2. **Transcribe, or reuse existing transcripts.**
3. **Mine candidates.** Read the transcripts and pull moments as **verbatim quotes with
   timecodes**. Never paraphrase into the candidate list — a reworded candidate becomes an
   invented line three steps later.
4. **Tier by strength** and record why each one earns its tier.
5. **Dedupe hard by topic.** The same argument will appear three or four times across a
   shoot. Pick the single best telling and drop the rest.
6. **Verify each pick on frame** before committing — the speaker is sometimes in profile,
   back to lens, or blocked by a customer. A verbally perfect moment can be visually
   unusable.
7. **Present the clip list for approval.** Hook, script map, trim notes, b-roll cues, title
   options. **Do not build before this is approved.**

*Selection doctrine — tiering, deduping, hook standards, cutting judgement — is in
`editorial.md`.*

### Build

8. **Create the sequence.** `create_sequence` ignores the requested format and always
   produces 1080×1920/30, and the settings cannot be corrected afterwards. **Duplicate an
   existing correctly-formatted sequence and empty the copy instead.** See
   `premiere-gotchas.md`.
9. **Never edit a master sequence destructively.** New sequence per batch; the master stays
   untouched and its clip count unchanged.
10. **Place clips.** Assemble with source in/out points rather than razor-then-delete — one
    call per clip, deterministic, and it never disturbs what is already on the timeline.
    **Never hand-compute timeline offsets.** Premiere floors source points and rounds
    timeline positions; computing these by hand produces one-frame black gaps that are
    invisible in tool responses and obvious on playback. See `CLAUDE.md` for the frame maths
    and the script that handles it.
11. **Marker per short**, named with the hook, at each start.
12. **Spacing between shorts** — consistent, so boundaries stay legible when the batch is
    reviewed as one timeline.
13. **Grade pass.** Source footage is typically flat and ungraded — a grey veil across every
    frame. One contrast/saturation pass across all clips, kept subtle.
14. **Graphics** — section 4.
15. **Captions** — section 5.
16. **Logo and end card** on every short. Placement values per sequence format are in
    `design-system.md`; the CTA rule is in `brand.md`.
17. **QA** — section 7.
18. **Export** — section 6.

---

## 3 · Podcast editing workflow

**⚠️ This section is not yet documented — see TODO-W1.**

What is established:

- The podcast is *Just Build Baby*. Host and guest labelling conventions are in `people.md`.
- Studio interviews are **16:9**, shot with two-shot and single coverage.
- Lower-third cards sit **left-aligned** with a 10px rule, positioned so both faces stay
  clear in the two-shot.
- The logo goes **top right** in 16:9, overriding the top-centre 9:16 rule.
- Episodes are mined for short-form clips using the same selection doctrine as section 2.

What is **not** documented anywhere in this repository: the actual edit process — coverage
and angle-switching decisions, intro and outro structure, music and audio treatment, chapter
or segment conventions, episode-level deliverables, and how a full episode differs from a
clip pull.

Until this is written, treat podcast edits as bespoke and record what was done.

---

## 4 · Graphics workflow

1. **Decide whether the beat wants a graphic at all.** The b-roll-versus-graphic rule is in
   `broll.md`. Short version: b-roll when the thing exists and can be shown; a graphic when
   it is abstract, numeric or invisible.
2. **Author the composition.** Style, tokens, layout and motion are in `design-system.md`.
   Invoke the HyperFrames skill first — it is the source of truth for composition structure.
3. **Lint before rendering.** It catches the timing-attribute mistakes that otherwise render
   as blank frames.
4. **Render.**
   - **Overlay → transparent ProRes 4444.** The composition must set
     `background: transparent`, or the render is an opaque rectangle covering the footage.
   - **Full-frame → MP4.**
   - **Match the sequence frame rate.** A 59.94 sequence needs the rational form, not a
     rounded integer.
5. **Import**, then **file it into the project's graphics bin explicitly.** Passing a bin
   name at import does not reliably file anything — move the item afterwards. See
   `premiere-gotchas.md` for the correct parameter.
6. **Place** on a video track above the footage.
7. **Verify the timing** — below.

### Never re-render over a linked filename

Premiere links media by **file path**. Re-rendering to a path Premiere already has linked
makes it serve cached media or lose the frame reference entirely.

**Always render a revision to a new unique filename** — increment a version suffix
(`-v2`, `-v3`). Then re-import, remove the old clip, and place the new one.

**A retimed graphic is usually a different duration than the clip it replaces.** Check the
new length before placing it; the old timeline clip is the wrong size.

*(Learned twice independently: once when a re-render was served from cache, once when
corrected graphics were written to the same filenames and had to be re-rendered again under
new names.)*

### Verifying a reveal lands on or after the spoken word

**The rule:** a graphic must never reveal information before it is said. This has failed in
production and required a full re-render and re-place cycle.

The audit method, which is reusable on any project:

```
1. Find the phrase in the source clip's .words.json  →  src_time
2. Convert source time to timeline time:
      timeline_time = clip.start + (src_time − clip.inPoint)
3. Compute the graphic's actual reveal time:
      reveal_time = graphic_clip.start + internal_animation_offset
4. Assert:  reveal_time >= timeline_time
```

Step 3 matters and is easy to forget: a graphic's headline may animate in some fraction of a
second **after** the clip starts, so the clip start alone is not the reveal time.

Check **every** reveal in a graphic, not just the first — a checklist graphic has one per
item.

---

## 5 · Caption workflow

1. **Generate** from the word-level transcript.
2. **Review every quoted line against the audio.** This is not optional.
3. **Resolve or cut.** A known mis-transcription gets corrected from the lexicon in
   `terminology.md`. An unresolved one gets **cut from the clip** — never guessed, never
   paraphrased.
4. **Style** per `design-system.md`.
5. **Burn in.**

Captions are non-negotiable on conversational audio. Full policy, including the escalation
path for a garbled line, is in `captions.md`.

---

## 6 · Export workflow

Export is the stage most likely to silently produce wrong files. The constraints are
mechanical.

| Constraint | Detail |
|---|---|
| **Preset** | Requires an **absolute path to a `.epr` file**. Format names like "mp4" or "h264" are rejected. |
| **Adobe Media Encoder must be running** | Export queues to AME. Without it, nothing renders. |
| **Rendering is asynchronous** | The tool call returns before the file exists. |
| **In/out per short** | Set sequence in/out points, then export that range. |
| **Export strictly sequentially** | **Wait for each file to stop growing before queuing the next.** Queuing several at once risks every job picking up the last in/out points set — producing a batch of identical wrong files that look successful. |

### After each export

- **Verify the duration against the timeline span.** A shipped batch was validated this way
  and every file landed within 0.02s.
- Confirm the file size is plausible for the duration and format.

`exports/` is gitignored — a clone has no outputs.

---

## 7 · QA checklist

Every item below exists because it failed at least once. Run before export, and again before
handoff.

### Project and session

- [ ] Bridge running.
- [ ] `get_project_info` confirms **the correct project is frontmost** — checked before each
      build step, not once at the start.
- [ ] Master sequence untouched; clip count unchanged from before the session.

### Trusting results

- [ ] **No operation reported as successful on the strength of a tool response alone.** A
      large share of the tool surface returns success while doing nothing. Every write is
      confirmed with a read tool. See `premiere-gotchas.md`.

### Timeline

- [ ] No overlapping clips on any video track.
- [ ] No unintended gaps — including one-frame black gaps between butted clips.
- [ ] Every short has a named marker at its start.
- [ ] Spacing between shorts is consistent, or any deviation is deliberate and recorded.

### Graphics

- [ ] **Every reveal lands on or after the spoken word** — audited per section 4, per reveal,
      not per graphic.
- [ ] No graphic is a stale cached render — every revision has a new filename.
- [ ] Every generated graphic is filed in the project's graphics bin.
- [ ] Overlay graphics have a real alpha channel, not a black box.

### Brand

- [ ] Logo present on **every** short, on V3, at the correct position and scale for the
      sequence format.
- [ ] Standard end card on **every** short. No exceptions.
- [ ] Logo ends where a full-frame CTA begins — the two never stack.

### Content

- [ ] **No unresolved transcription garble inside any burned-in caption.**
- [ ] No name on screen that was inferred rather than confirmed.
- [ ] No place name that was not said on camera.
- [ ] Every on-screen figure checked against `verified-facts.md`, including any required
      qualifier.
- [ ] No invented dialogue anywhere — every spoken line is verbatim.

### Export

- [ ] Exported sequentially, each file confirmed complete before the next was queued.
- [ ] Every exported duration matches its timeline span.

---

## 8 · Publishing handoff

What ships at the end of a shorts batch:

| Deliverable | Detail |
|---|---|
| **One video file per short** | Complete and self-contained, **including its end card** |
| **One transcript per short** | Timestamped **relative to that short's own start**, not the parent timeline |
| **One manifest** | Machine-readable index of the batch |

### Manifest

One record per short, carrying at minimum: sequence number, filename slug, human-readable
name, start, end and duration. This is the **canonical key** for the batch — when a short is
referred to by number anywhere downstream, it means the manifest number.

> ⚠️ **Numbering hazard.** A batch is usually planned in one order and published in another.
> Do not carry a build-order number into delivery. **The manifest number and slug are the
> identity of a short from export onward** — a plan-order number referring to a different
> clip is a real and previously-encountered source of confusion.

### Naming

`NN-kebab-case-descriptive-slug` — zero-padded number, lowercase, hyphenated, derived from
the short's title. Video and transcript share the base name.

### Alongside the files

- **Three title options per short**, so the publisher can choose per platform.
- **Platform priority** — which shorts are strongest on which platform. Doctrine in
  `editorial.md`.

---

## Scope of this document

This file defines process only.

- Command syntax, flags and scripts belong in `CLAUDE.md`.
- Tool behaviour, bugs and workarounds belong in `premiere-gotchas.md`.
- Selection and cutting judgement belongs in `editorial.md`.
- Coverage and b-roll choices belong in `broll.md`.
- Visual specifications belong in `design-system.md`.
- Caption policy belongs in `captions.md`.
- Asset identities and paths belong in `assets.md`.

---

## TODOs

**TODO-W1 — Document the podcast editing workflow.**
Section 3 is a stub. Nothing in this repository describes how a *Just Build Baby* episode is
actually edited: coverage and angle decisions, intro/outro structure, music and audio
treatment, segment conventions, episode deliverables, or how a full episode differs from a
clip pull. This is the largest documentation gap in the knowledge base.
*Blocks:* any podcast work done from documentation rather than memory.

**TODO-W2 — Confirm the per-format frame-rate rule.**
Graphics must render at the sequence frame rate, and 59.94 sequences need the rational form
rather than a rounded integer. Worth confirming as a standing rule and recording the exact
values per sequence format, so it is not re-derived per project.
*Blocks:* nothing today — prevents a class of silent mismatch.

Both indexed in `open-questions.md`.

---

## Sources

| Content | Origin |
|---|---|
| Bridge startup; transcript and graphics workflow shapes; assemble-with-in/out preference; frame-maths warning | `CLAUDE.md` — Workflows 1 and 2, gotchas |
| Export mechanics: `.epr` requirement, AME dependency, async render, sequential-export rule | `SHORTS-HANDOFF.md` — delivery notes |
| Graphic reveal-timing audit method and its failure history | `SHORTS-HANDOFF.md` — graphics state and corrections |
| Never re-render over a linked filename | `SHORTS-HANDOFF.md`; session memory — `feedback_premiere_unique_filenames` |
| Duplicate-a-sequence workaround; bin filing; frontmost-project trap | `SHORTS-HANDOFF.md` — tool gotchas found live |
| Analysis-then-approval sequence; grade pass; markers; spacing | `SHORTS-HANDOFF.md` — brief and next steps; `SHORTS-PLAN.md` — global treatment |
| Verify picks on frame before committing | `SHORTS-HANDOFF.md`; `SHORTS-CANDIDATES.md` — selection guidance |
| No diarisation; model-escalation lesson | `SHORTS-HANDOFF.md` — production notes |
| Delivery shape: per-short video, per-short transcript, manifest, duration verification | `exports/shorts/` and `_manifest.json` as shipped |
| Numbering hazard | Comparison of `SHORTS-PLAN.md` clip order against `_manifest.json` publication order |
| 16:9 interview conventions | Session memory — `buildx-graphics-conventions` |

Scripts referenced indirectly (transcription, cut planning, graphic rendering, tool audit)
live in `scripts/`. This file deliberately does not reproduce their flags — see `CLAUDE.md`,
which is maintained alongside them.
