# Presets

Reusable treatments applied through the Premiere MCP's `apply_effect` tool.

`apply_effect` takes a `clipId`, an `effectName` matching Premiere's own effect name, and a
`parameters` object. Names must match exactly as they appear in Premiere's Effects panel.

## Dialogue audio chain

Applied to talking-head clips after a rough cut, in this order:

1. **Hard Limiter** — ceiling around `-1.0` dB. Catches peaks so nothing clips.
2. **Dynamics** or **Multiband Compressor** — evens out delivery.

Apply the limiter *last* in the chain so it catches whatever the earlier stages let through.

Premiere's scripting API **cannot read audio levels** — there is no way to measure loudness
from inside the MCP. To target a specific LUFS, measure with ffmpeg first:

```bash
ffmpeg -hide_banner -i "footage.mp4" -af ebur128 -f null - 2>&1 | tail -12
```

Then set gain from the measured integrated loudness (broadcast/YouTube target: -14 LUFS;
podcast: -16 LUFS).

## Colour

`Lumetri Color` via `apply_effect`. Keep grades subtle on talking-head footage — contrast
and a small exposure lift usually beat a heavy look.

## Grain / texture overlays

Prefer building these as HyperFrames overlays (see the `graphic-to-premiere` skill) rather
than as Premiere effects. You get exact control, and the same overlay is reusable across
projects. Render with `--alpha` and drop it on a track above the footage at low opacity.

## Caveat

`remove_effect` does not exist — Premiere's API cannot remove an applied effect. If you
apply the wrong one, call `undo` immediately rather than trying to strip it afterwards.
