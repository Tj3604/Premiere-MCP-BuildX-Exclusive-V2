# CHANGELOG.md

# Changelog

All notable changes to the BuildX Claude Video Editor should be
documented here.

------------------------------------------------------------------------

# Version 2.4

Released 2026-08-18.

Moves five capabilities out of the MCP and into local scripts, because
the tools that claim to provide them return success and do nothing. The
CEP bridge runs ExtendScript, which Adobe sunsets in September 2026, so
each of these deliberately reduces what has to happen inside Premiere.

## Computer use is a scoped GUI fallback

-   **Scope, not capability.** The `computer-use` MCP now drives Premiere's
    GUI, but only for four operations that have no working API:
    caption creation, FCPXML import, sequence creation at 29.97 /
    1080×1920, and Media Encoder queueing — plus independent visual
    verification. Everything else stays on the bridge, Bash and XML
-   **Caption creation is not a no-op, it is a void.**
    `activeSequence.captionTracks` is `undefined` in ExtendScript —
    caption tracks cannot be created, listed or read by script at all.
    This is a third category beyond *real* and *fake-success*, now
    recorded in `TOOL-RELIABILITY.md`
-   `gui/SETUP.md` documents setup, the click path, the seven hard
    rules and the verification procedure. `gui/evidence/` holds
    before/after screenshots and `verification-log.jsonl`
-   **Never per-clip.** If an operation runs more than once per project
    it belongs in a script. The GUI is slow, unverifiable in bulk, and
    every click is a chance to mutate the wrong project
-   Verified end to end on a sandbox copy: 44 captions created on
    `INT_041_CTA`, style and character limits honoured. **The dialog's
    `Minimum duration` was not** — measured 0.40s–1.97s against a 1.2s
    setting, so measure output rather than trusting dialog values

## Sequence format is checked, and the check stops you

-   `scripts/check-sequence.mjs` reads the sequence back and **hard
    fails** on anything that is not 29.97 / 1080×1920. It does not warn
    and continue: a 30 fps timeline against 29.97 source drifts
    invisibly until playback
-   The obvious tool for this does not work. **`get_full_sequence_info`
    does not report frame rate at all** — verified live, it returns
    name, id, durationSeconds, width, height and tracks, with no
    timebase of any kind. `get_sequence_settings` is the one that
    exposes it, as `timebase`, where fps = 254016000000 / timebase
    (29.97 = 8475667200)
-   Comparison is on exact integer tick counts, not float fps. 29.97 is
    30000/1001 and never lands on a clean decimal
-   `scripts/new-project.mjs` copies a known-good template project under
    the `X#### (surname)` convention. Sequences still cannot be created
    programmatically — `create_sequence_from_preset`,
    `set_sequence_frame_rate` and `set_sequence_resolution` are all
    no-ops — so a template on disk is the only reliable route

## Timeline interchange via FCP7 XML

-   `plan-cut.mjs` gains `--xml` / `--media` and emits xmeml v5 beside
    its existing `calls` array. Both come from the same integer frame
    numbers, so they describe the same cut. Without `--xml` the output
    is byte-identical to before
-   Time is emitted as exact rationals — at rate num/den, frame F is
    F*den/num seconds — so nothing round-trips through a float
-   **Neither path drifts.** Measured 0 frame drift on a 10-cut rough
    and on cuts 2.5 hours into a master. `plan-cut.mjs`'s existing
    midpoint-for-source / boundary-for-timeline compensation was already
    frame-exact. The reason to prefer XML is that it does not touch the
    bridge, not precision
-   XML import is a manual `File > Import`. `import_sequences` is a
    no-op. That human step is expected, not a bug

## Shot detection

-   `scripts/detect-scenes.mjs` replaces the no-op
    `scene_edit_detection`. Video in, JSON shot list with absolute
    timecodes out, even when `--start` is used
-   Uses PySceneDetect's **AdaptiveDetector**, which is the only setting
    correct at both ends. Measured on 60s samples: `detect-content` at
    its default threshold of 27 **misses** a real talking-head jump cut,
    and at 8 it turns 60s of continuous handheld GoPro into 25 false
    shots. Adaptive returns the true count on both
-   Verified against ground truth read off the timeline, not eyeballed:
    a jump cut at 17.251s is returned as 17.251s

## Vertical reframe as an ingest step

-   `scripts/reframe-vertical.mjs` renders a 1080×1920 master into
    `reframed/`. It is never a timeline operation — all five Motion
    tools are no-ops, so this cannot happen inside Premiere
-   Defaults to the `talking_head` preset and handcrafted saliency, and
    **exits non-zero if the saliency backend it actually ran is not the
    one requested.** Silent fallback is the failure mode worth catching
-   Detects the wrong-subject crop. On a wide two-shot every statistic
    was perfect — 720/720 frames framed, 0 switches, 0 fallback — while
    the crop sat on the set between the two subjects with both people
    out of frame. `frames_with_face` counts faces **inside the output
    crop**, so zero faces alongside tracked subjects is the only signal
    that catches it
-   Two-person framing is geometrically impossible on a wide two-shot: a
    9:16 crop is 31.6% of a 1920×1080 frame and two seated subjects span
    roughly 84%. Cut between single-camera ISOs instead

## Transcription audio, and why denoising is off

-   `scripts/prep-audio.mjs` prepares audio for **transcription only**.
    It writes to `transcription-audio/`, never overwrites source media,
    and never routes into the edit
-   **DeepFilterNet is installed but off by default, because it was
    measured to make transcription worse.** Real jobsite ambience mixed
    under studio speech to 9.9 dB SNR, scored against a clean-speech
    reference: untouched 12.36% WER, normalize-only 11.61%,
    denoise-only 17.60%, full chain 17.23%
-   Denoising lifted SNR from 9.9 dB to 33.4 dB and still cost about 5
    WER points, substitutions rising from 10 to 22. It trades noise for
    speech distortion and the aligner minds the distortion more. On
    clean studio audio it also invents words
-   Order is denoise → normalize → trim, because denoising changes the
    RMS. Normalize alone is a small genuine win and is what ships
-   The SNR estimate uses a percentile over ~0.4s windows rather than
    astats' own `Noise floor dB`, which reports `-inf` whenever a window
    contains true digital silence — common in recorder files. An
    unmeasurable SNR is now a hard error, not a silent skip

## WhisperX transcription

-   `scripts/transcribe-x.mjs` sits **alongside** `transcribe.mjs`,
    which is unchanged and remains the fallback. Forced alignment plus
    VAD gating, so the model stops hallucinating into interview pauses
-   Schema is additive — `speaker`, `score`, `interpolated` per word —
    so `plan-cut.mjs` consumes the output unmodified
-   Measured on 3 minutes of real interview audio, 534 words: word
    starts a median 57 ms from energy onsets, ends 96 ms, 0 unaligned
    words, 2.1× realtime on CPU
-   Guards against silent input. Camera ISOs can carry a digitally
    silent audio track with the real audio in a separate recorder file,
    which otherwise yields an empty transcript that reads as a tool
    failure
-   Diarization is wired but **unverified** — it needs `HF_TOKEN` in
    `.env` and accepted terms on the two pyannote models

## Known gaps

-   `presets/buildx-vertical-template.prproj` is not in the repo. It has
    to be authored by hand in Premiere once;
    `scripts/new-project.mjs` prints the exact settings when it is
    missing
-   Diarization untested pending a HuggingFace token
-   `TOOL-RELIABILITY.md` has not been regenerated for this release

------------------------------------------------------------------------

# Version 2.3

Released 2026-08-12.

## Exports are capped at 480 MB

-   Adobe Media Encoder encodes to whatever the `.epr` preset says and
    has no notion of a target file size, so a 4K timeline routinely
    landed well over any delivery limit. `export_sequence` now enforces
    a **480 MB** budget by default
-   After queueing, `export_sequence` waits for the render (AME gives no
    completion callback, so it watches the output file stop growing),
    measures it, and re-encodes anything over the cap with a **two-pass
    ffmpeg** bitrate derived from the file's real duration. Single-pass
    CRF cannot hit a size target — it yields whatever size the content
    needs, which is the problem being solved
-   New `compress_export` tool applies the same cap to any file already
    on disk. It no-ops and reports success when the file is already
    under, so it is safe to run over a whole delivery folder
-   New options on `export_sequence`: `maxSizeMB`, `autoCompress`,
    `replaceOriginal`, `compressCodec`, `waitTimeoutMinutes`
-   **Alpha is refused, not flattened.** `h264`/`hevc` are `yuv420p`
    only, so compressing a ProRes 4444 overlay would silently drop its
    transparency and turn the lower third into an opaque black box —
    invisible until playback. Files with an alpha pixel format are left
    untouched with an explanatory error. `allowAlphaLoss: true` overrides
-   **Nothing is overwritten by default.** The compressed file is written
    as `<name>-under480mb.mp4` beside the original, so a render Premiere
    has already imported keeps its media link. `replaceOriginal: true`
    swaps in place instead, and only after the re-encode is verified for
    readability and duration drift
-   `add_to_render_queue` deliberately does **not** wait or compress. Its
    contract is "hand the job to AME and return"; run `compress_export`
    on the output afterwards
-   Fixed: the `export_sequence` success test had asserted
    `renderSequence` was called with three arguments when it has always
    passed four. The assertion never ran because the test timed out
    first, so the mismatch sat unnoticed

------------------------------------------------------------------------

# Version 2.2

Released 2026-08-11.

## `.mcp.json` no longer ships a hardcoded local path

-   `.mcp.json` held one contributor's absolute home path and was
    committed, so every clone had to hand-edit it before any Premiere
    tool worked
-   `.mcp.json` is now **gitignored** and `git rm --cached`'d;
    `.mcp.json.example` is the tracked template, with a `__REPO_ROOT__`
    placeholder
-   Added `scripts/init-mcp-config.mjs`, which renders the template with
    this clone's absolute path (`--force` to overwrite, e.g. after
    moving the repo). It is idempotent and warns when `dist/index.js`
    has not been built yet
-   `npm run setup:mac` now runs it, so a fresh clone needs no manual
    edit at all
-   **The path must stay absolute.** Verified: Claude Code resolves a
    relative `args` entry against the process working directory, so it
    connects from the repo root and fails from any subdirectory, and
    `${CLAUDE_PROJECT_DIR}` is not expanded in `.mcp.json`
-   `SETUP.md` rewritten accordingly ("Fix the server path" → "Generate
    `.mcp.json`") plus two new troubleshooting rows

## `run-buildx-hook` no longer assumes `~/Downloads`

-   `driver.mjs` and `recorder.mjs` both hardcoded `resolve(homedir(),
    'Downloads')` as the hook location *and* the static server root, so
    the skill shipped to every clone but had nothing to run against
-   New `hooks-dir.mjs` resolves a hook by search order —
    `$BUILDX_HOOKS_DIR`, then the repo's `hooks/`, then
    `~/Downloads/TM Hooks/`, then `~/Downloads/`. Whichever folder the
    hook is found in becomes the server root
-   A path argument (absolute or relative) is used as-is and skips the
    search; a miss now lists every folder tried
-   `hooks/buildx-hook-gfa-vs-sqft.html` added as the canonical
    template, so a fresh clone can screenshot something immediately.
    The rest of the local hook library stays out of the repo
-   Outputs are written next to their hook; `hooks/*-preview.png` and
    `hooks/*.mov` are gitignored

## Two bugs found while de-hardcoding the hook skill

-   **Preview screenshots were cropping the frame.** `driver.mjs`
    hardcoded a `600,1067` viewport while hooks are authored on a fixed
    **1080x1920** canvas — so every preview lost the right ~44% of the
    frame. On the `gfa-vs-sqft` template that hid the em-dash *and* the
    entire secondary line ("DON'T LEAVE ADU SIZE ON THE TABLE"), while
    looking like a clean screenshot. Since verifying copy is what these
    previews are *for*, this silently defeated the skill. Now 1080x1920,
    overridable with `BUILDX_HOOK_VIEWPORT`. `recorder.mjs` was already
    correct at 1080x1920
-   **A server on port 5500 was reused without checking what it serves.**
    The check was "is anything listening on 5500", so VS Code Live Server
    or a run against a different hooks folder would answer 404 — arriving
    as a blank screenshot rather than an error. Now the port is only
    reused if it actually serves the requested hook; otherwise the skill
    starts its own on the next free port (5501, 5502, …)

## Other hardcoded paths removed

-   `mcp/premiere-pro-mcp/CONTRIBUTING.md` linked `bridge-cep.js` via
    the **upstream author's** absolute path — broken in every clone.
    Now a repo-relative link
-   `HANDOFF.md` gave a `cd` command with a contributor's home path
-   `design-system.md` / `people.md` pointed at one contributor's
    session-memory directory; now `~/.claude/projects/<project-slug>/`
-   `SHORTS-HANDOFF.md`, `SHORTS-MANIFEST-LEMON.md` and
    `shorts-lemon-plan.json` recorded source media by absolute home
    path; now `~`-relative, or repo-relative where the file is in-repo
-   No tracked file contains a contributor's username or `/Users/...`
    home path any more

## Upgrading from 2.1.1 — one manual step

`.mcp.json` was removed from version control, so **`git pull` deletes
your working copy of it** and every Premiere tool disappears from Claude
Code. Regenerate it once, after pulling:

``` bash
node scripts/init-mcp-config.mjs
claude mcp list   # expect: premiere-pro ... ✔ Connected
```

Nothing else carries over — the generated file is identical to the one
that was tracked.

------------------------------------------------------------------------

# Version 2.1.1

Released 2026-08-11.

## Safe Zones — SZ3 closed

-   Applied the 108px edge-safe side margin to the remaining 17
    compositions (10 `faq-cards`, 5 `lt-g*`, 2 `lt-id-*`)
-   All 31 compositions are now consistent; `grep -rE "left:(51|80)px"`
    over `graphics/` returns nothing
-   All 17 lint clean; three archetypes snapshot-checked for reflow at
    the narrower column width — nothing overflowed or clipped
-   **SZ3 closed** in `open-questions.md`

## Safe Zones — SZ5 opened

-   Found while verifying SZ3: **34 elements sit below the 192px bottom
    control-safe line**, where platforms draw captions and buttons
-   Includes the "BuildX. Just build baby." kicker in all 10
    `faq-cards`, at `bottom:150px` — 42px inside the covered band
-   All are frame-relative, so these are true frame offsets
-   Logged as **SZ5**, High priority. No graphics changed for it

------------------------------------------------------------------------

# Version 2.1

Released 2026-08-11.

## Anonymised Examples

-   Added `graphics/example-lower-third`, `example-question-card` and
    `example-statement-card` — reference builds with placeholder copy,
    carrying no customer name, footage or pricing
-   `example-question-card` ships a gradient in place of the freeze
    frame, since freeze frames are stills of real customer footage
-   Each documents the v2.0 safe-zone geometry inline; all lint clean

## Safe Zones — SZ3 partial rollout

-   Side margin raised from 51px/80px to the 108px edge-safe line in 14
    compositions
-   **17 compositions still carry the old margin** — 10 `faq-cards`,
    5 `lt-g*`, 2 `lt-id-*`. `graphics/` is inconsistent until this
    finishes; copy `example-*` rather than an arbitrary composition
-   SZ3 remains **open** in `open-questions.md` with the outstanding
    list recorded

## Setup and Packaging

-   `SETUP.md` rewritten against the actual repo: names **Claude Code**
    (not Claude Desktop), lists real dependencies (Node ≥18, Premiere
    2026, ffmpeg, npx network access; no Python), documents CEP bridge
    startup and the `.mcp.json` path fix
-   `npm run build` documented as **required** — `dist/` is gitignored,
    so a fresh clone has no server, and the `set_param_value` patch that
    fixes logo placement does nothing until compiled
-   `.gitignore` now blocks freeze frames and customer stills, and
    covers `.claude/settings.local.json`, previously protected only by a
    machine-local global ignore
-   Recorded in `.gitignore` that ignoring cannot untrack what is
    already committed

------------------------------------------------------------------------

# Version 2.0

Released 2026-08-11.

## Safe Zones

-   Added `knowledge/buildx/safe-zones.md` — platform safe zones for
    YouTube, Instagram and TikTok, with the working 9:16 values BuildX
    uses (top 192px, bottom 1728px, sides 108px / 972px)
-   Recorded two arithmetic inconsistencies on the source reference
    graphic rather than silently correcting them
-   Noted that the right side needs the most care, because the 9:16
    action rail runs deep into the frame

## Logo Placement Correction

-   **Breaking:** the 9:16 logo moved from `[0.5, 0.0385417]` / scale 54
    to `[0.5, 0.1530]` / scale 40. The old values put the logo's top
    edge at −31px — cropped off the top of frame, and under the iPhone
    Dynamic Island
-   The new y value is derived, not chosen: `192 + 24 + 156/2 = 294px`
-   1728 × 3072 rescaled to match: `40 × 1.6 = 64`
-   Updated the derivation worked example in `design-system.md`, the
    standing rule and `set_param_value` example in `CLAUDE.md`
-   16:9 placement is flagged as not yet checked against safe zones

## Knowledge System

-   Routed `safe-zones.md` into the `CLAUDE.md` and
    `knowledge/buildx/README.md` read-order tables
-   Closed **C1** (standing caption safe area) and **SZ2** (logo inside
    the title-safe band)
-   Opened **SZ1**, **SZ3** and **SZ4** — portrait inset, side margin,
    and whether the end-card asset's own logo clears the safe zone

## Lemon Project

-   Added the Lemon shorts build: 22 HyperFrames compositions under
    `graphics/lt-*`, plus `SHORTS-MANIFEST-LEMON.md` and
    `shorts-lemon-plan.json`

------------------------------------------------------------------------

# Version 1.0

## Initial Release

### Knowledge System

-   Added BuildX knowledge base
-   Introduced routing through CLAUDE.md
-   Organized editorial standards
-   Added production workflow documentation

### Premiere Integration

-   Integrated Premiere MCP Bridge
-   Added tool reliability documentation
-   Validated read and write workflows

### Validation

-   Completed architecture review
-   Completed Tier 2 Premiere validation
-   Documented known MCP behavior
-   Established validation methodology

### Future Roadmap

Potential improvements:

-   Canonical asset library
-   Automatic project-bin organization
-   Automated QA
-   Improved export workflow
-   Additional Premiere capabilities
