---
name: graphic-to-premiere
description: Build a motion graphic and drop it onto the Premiere Pro timeline. Use when asked to create a graphic, animation, title card, lower third, overlay, callout, intro, or motion graphics for a video edit — especially when it should land in Premiere. Authors a HyperFrames composition, renders it (transparent ProRes 4444 for overlays, MP4 for full-frame), and imports it onto the timeline.
---

# Graphic → Premiere

Authors motion graphics as HTML, renders them to video, and places them on the timeline.

## Step 1 — Pin down the look before writing any HTML

Generic prompts make generic graphics. Establish, and state back:

- **Motion feel** — stepped/choppy (8-12fps) or smooth (30fps)?
- **Texture** — clean, grain, halftone, paper, grunge?
- **Palette + type** — specific colors and fonts.
- **Beat-by-beat action** — what appears, moves, and leaves, in order, with rough timings.

If the user is vague, propose 2-3 concrete directions rather than guessing. Creative
direction is the input to this system; it cannot be inferred from "make it look good".

Check `graphics/` for an existing composition with the right look and copy it as a starting
point before building from scratch.

## Step 2 — Scaffold

```bash
cd graphics && npx hyperframes@latest init my-graphic --example blank --non-interactive
```

## Step 3 — Author

**Invoke the `hyperframes` skill before writing composition HTML** — it owns the timing
contract, and skipping it produces compositions that render blank.

Non-negotiables:

- Every timed element needs `class="clip"` plus `data-start`, `data-duration`, `data-track-index`.
- The timeline must be `paused` and registered on `window.__timelines["<composition-id>"]`.
- Deterministic only — no `Date.now()`, no `Math.random()`, no network fetches at render time.
- **For overlays, set `background: transparent` on `html, body`.** A solid background
  renders an opaque rectangle that hides the footage under it.

Then lint — it catches the timing mistakes that silently render as empty frames:

```bash
cd graphics/my-graphic && npx hyperframes@latest lint
```

## Step 4 — Render

```bash
# Overlay (lower third, callout, captions) — transparent ProRes 4444
node scripts/render-graphic.mjs graphics/my-graphic --alpha --fps 30 --quality high --name my-graphic

# Full-frame graphic — MP4
node scripts/render-graphic.mjs graphics/my-graphic --fps 30 --quality high --name my-graphic
```

Use `--quality draft` while iterating; `high` only for the final pass.

The command prints the absolute output path in `renders/`. Use that path verbatim.

### Verify the alpha actually survived

Before importing an overlay, confirm it is not an opaque block:

```bash
ffmpeg -hide_banner -ss 1 -i renders/my-graphic_ProRes4444.mov \
  -vf "alphaextract,signalstats,metadata=print" -frames:v 1 -f null - 2>&1 | grep -E "YMIN|YMAX"
```

`YMIN` equal to `YMAX` means the frame is uniformly opaque (or empty) — the transparency
was lost. A real overlay shows a spread between them.

## Step 5 — Place in Premiere

Bridge must be live (`Window > Extensions > MCP Bridge (CEP)` → Start Bridge).

1. `import_media` with the absolute render path → project item ID.
2. `add_to_timeline` with:
   - `trackIndex` **above** the footage (footage on `0` → overlay on `1`).
   - `time` = where it should appear on the timeline, in seconds.
   - `insertMode: "overwrite"` so it doesn't shift the edit underneath.

Overlays are usually silent — pass `linkAudio: false` to stop Premiere adding an empty
audio clip on the audio tracks.

## Step 6 — Show the result

Export a composited frame so the user can see it over real footage rather than taking your
word for it, then report what you built and offer specific adjustments.
