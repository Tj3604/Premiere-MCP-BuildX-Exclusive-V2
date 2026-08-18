# Computer Use — Setup & Caption Runbook

How to drive Premiere Pro's GUI from Claude Code via the `computer-use` MCP, and the one recipe it
exists for today: **creating a caption track**.

Computer use is the **last-resort tier**. Read `TOOL-RELIABILITY.md` and
`../CLAUDE.md` first. If the CEP bridge or a working MCP tool can do the job, it does the job.

---

## 1. Why this exists

Of 281 MCP tools, 97 return `success: true` and do nothing. Four operations are GUI-only as a result:

| Operation | Why GUI |
|---|---|
| **Caption creation** | `sequence.captionTracks` is **`undefined`** in ExtendScript — verified 2026-08-18 via the bridge. There is no scripting surface at all, not a broken one. |
| FCPXML import | `import_sequences` is a no-op |
| Sequence creation @ 29.97 / 1080×1920 | all four sequence tools are no-ops |
| Export / Media Encoder queueing | all encode tools are no-ops |
| Visual verification | independent check that a mutation actually happened |

Nothing else. If an operation runs more than once per project, it belongs in XML or a script.

---

## 2. One-time machine setup

1. **Bump Premiere's UI scale** — `Premiere Pro > Settings > Appearance > UI Scaling`, up a notch or
   two. Screenshots downscale to ~1372×887; default panel text is marginal. Biggest single predictor
   of whether this works.
2. **Grant macOS permissions to Terminal**, in `System Settings > Privacy & Security`:
   - **Screen Recording** → Terminal
   - **Accessibility** → Terminal

   The grant belongs to the **host app** (Terminal.app), not to Claude and not to the MCP server.
   Confirm which app owns the process rather than guessing:

   ```bash
   pid=$$; while [ "$pid" -ne 1 ]; do line=$(ps -o ppid=,comm= -p "$pid" 2>/dev/null); \
     [ -z "$line" ] && break; ppid=$(echo "$line" | awk '{print $1}'); \
     comm=$(echo "$line" | cut -d' ' -f2-); echo "$pid  $comm"; pid=$ppid; done
   ```
3. **Enable the server** — `/mcp` → `computer-use` → Enable. Per-project, once.
4. **Know the abort** — `Esc` kills the current action.
5. Interactive session only (no `-p`), and no second Claude Code session running — the machine-wide
   lock is held until the controlling session *exits*.

### ⚠️ Never "refresh" Screen Recording by toggling it off and on

Grants are bound **at process start**. Toggling the switch off invalidates it for the already-running
Terminal, and toggling it back on does *not* restore it until Terminal is fully quit (`Cmd+Q`) and
relaunched — which ends the Claude Code session.

**If screenshots worked earlier in the same session, the permission was never the problem.** Look
elsewhere before touching the toggle. This cost a full session on 2026-08-18.

---

## 3. Session start — every time

```
request_access(apps: ["Adobe Premiere Pro 2026", "Adobe Media Encoder 2026"])
```

Approve **Premiere and Media Encoder only**. Deny Finder. Deny anything flagged "equivalent to shell
access" — Claude already has the filesystem through Bash.

`request_access` returns `windowLocations`. **Premiere lives on the external display `LF27T450F`,
not the built-in.** Switch before the first screenshot or you capture an empty desktop:

```
switch_display("LF27T450F (1)")
screenshot()
```

---

## 4. Runbook — create a caption track

**Preconditions:** sequence open and active; a transcript already exists for it (Text panel →
Transcript tab shows text). Sandbox project only.

1. **Text panel → Transcript tab.** It may be a **floating panel on the second monitor** — check
   there before concluding it's closed. Confirm transcript text is present.
   - A `<clip>.mp4 is untranscribed` banner can appear *while* sequence-level transcript text is
     showing. Captions build from the **sequence** transcript, so this is not blocking. It is,
     however, the first thing to suspect if coverage comes up short.
2. **Create captions** → the Create captions dialog opens.
3. Set these four — **the same on every caption set, no per-job tuning**:

   | Field | Value |
   |---|---|
   | **Style** | `Thomas Default` |
   | **Layout** | `Single Line` |
   | **Maximum length in characters** | `20` |
   | **Minimum duration in seconds** | `1.2` |

   Leave **Format** = `Subtitle`, **Gap between captions** = `0` frames, **Remove Punctuation**
   unchecked.

   > **Caption preset ≠ Style.** The *Caption preset* dropdown at the top only offers stock format
   > presets — leave it on `Subtitle Default`. `Thomas Default` is selected in the separate **Style**
   > dropdown lower down. Setting the preset after the style resets the style.

4. **Re-read all four values before clicking.** `zoom` into the settings block and confirm against
   the table above — cheaper than undoing a wrong caption pass.
5. If the dialog's buttons sit below the screen edge, drag it up by its title bar. (Ask Thomas to
   move it if a drag fails — do not fight it.)
6. Click **Create captions**. A `C1` caption track appears above `V3`.

---

## 5. Verifying it actually worked

**Screenshot-zooming the timeline does not work** — caption clips are too narrow to render their
text, and you get an orange smear. Two checks instead:

**Coverage (structural).** Fit the sequence to the timeline and confirm the `C1` band spans the full
spoken portion, ending where the talking-head footage ends and the end card begins.

**Content (the real check).** Click in the **timeline ruler** to park the playhead on a caption, then
`zoom` into the **Program Monitor**. That reads the actual rendered pixels and proves style, line
count and character length in one look. **Sample at least three points** across the sequence — head,
middle, tail — not just the first caption.

Log agreement/disagreement to `gui/evidence/verification-log.jsonl`.

### Reading the timecodes — Feet + Frames

Premiere is set to a **Feet + Frames (16mm)** timecode display, not seconds. `SS+FF` is really
`feet+frames` at **40 frames per foot**, which is why frame values above 29 appear on a 29.97 fps
sequence and why `19+33` is legal, not a misread.

```
total_frames = feet * 40 + frames
seconds      = total_frames / 29.97
```

Cross-check against the bridge before trusting any duration you read on screen:
sequence readout `29+18` = 1178 frames = **39.3s**, which matches `activeSequence.end`
(`9984335961600 / 254016000000 = 39.306`) exactly. Reading `29+18` as 29.6 seconds is wrong by 10s.

### Reference run

A full pass on a sandbox project, as a shape to compare against:

- **44 captions** on a `C1 / Subtitle` track (count reads from the Properties panel header,
  e.g. `C1:Subtitle — 31 of 44`).
- Track Style resolved to **Thomas Default** = Poppins Bold, size 75, gold fill, 10px black outer
  stroke, shadow on.
- Coverage ran 0 → ~34s of a 39.3s sequence; the end card past ~34s correctly uncaptioned.
- Every Program Monitor sample was single-line and within 20 characters.

### ⚠️ Known: "Minimum duration" is not a floor

`Minimum duration in seconds = 1.2` **does not guarantee captions of at least 1.2s.** Six
consecutive captions measured off the Captions panel on the run above:

| # | Frames | Seconds |
|---|---|---|
| 27 | 18 | 0.60 |
| 28 | 28 | 0.93 |
| 29 | 30 | 1.00 |
| 30 | 59 | 1.97 |
| 31 | 12 | **0.40** |
| 32 | 25 | 0.83 |

Five of six sampled captions land under 1.2s. Caption boundaries are inherited from the **transcript
segment timings**; the minimum-duration value influences merging but transcript boundaries win, so
short phrases stay short.

Keep the setting at `1.2` — it is the house setting and it still shapes the longer merges — but
do **not** report "minimum 1.2s" as an achieved property of the output. If a hard floor is ever
required, it has to come from editing the transcript segments or post-processing an exported SRT,
not from this dialog.

## 6. Hard rules

1. Last resort, **once per batch** — never per-clip.
2. Never use computer use for what the bridge does reliably (`set_source_in_out`,
   `overwrite_from_source`, `import_media`, the read tools).
3. **Sandbox only** — `~/premiere-gui-sandbox/`, never a live `X#### (surname)` project.
4. **Never click:** `Save As`, `Project Manager`, `Consolidate and Transcode`, `Remove Unused`,
   `Make Offline`, `Link Media`, `Render and Replace`, `Replace Footage`, or anything under
   `File > Project Settings`. If a task seems to need one — stop and ask.
5. **Never dismiss an unexpected dialog.** Screenshot it, stop, report.
6. No app approvals beyond Premiere Pro and Media Encoder.
7. Screenshot before and after every GUI operation, saved to `gui/evidence/` with a timestamp.
   That directory is **git-ignored** — evidence is a per-run artifact and can name real projects.

## 7. Gotchas

- **A staged modal survives a Claude Code restart.** Premiere holds dialog state, so a permissions
  blowup mid-dialog is recoverable — leave the dialog untouched and resume with the click.
- **Menu clicks in a batch are fragile.** Menu item positions shift with workspace state; a
  mis-landed second click hit the **Type Tool** instead of `Window > Text` on 2026-08-18. Screenshot
  between opening a menu and clicking an item. If a stray tool gets selected, press `V` to restore
  the Selection tool **before clicking anything**, or you'll create a text layer.
- **`\` toggles panel maximize**, which hides everything else; `Window > Restore Frame Size` undoes it.
- Selecting an already-checked panel in the `Window` menu **toggles it off**.
- `zoom` reads from the **last full screenshot** — take a fresh `screenshot` after the screen changes
  or you'll get a blank strip.

---

## 8. Stop and ask before

- Touching any project outside `~/premiere-gui-sandbox/`
- Requesting approval for any app beyond Premiere Pro and Media Encoder
- Any operation that saves, consolidates, relinks, or deletes
- Starting an actual render or export (queueing to AME is allowed; **starting** it is not)
- Expanding computer use to any operation outside the sanctioned four
