---
name: hormozi-captions
description: >
  Generate Hormozi-style animated caption overlays for 9:16 short-form video (YouTube Shorts,
  Instagram Reels, TikTok). Use this skill whenever the user provides an SRT file or transcript
  and wants captions, subtitles, or text overlays styled for social media reels — especially
  when they mention "Hormozi", "viral captions", "caption overlay", "short-form captions",
  "white text black stroke", "gold keywords", or want to render a MOV/WebM caption overlay.
  Also trigger when the user wants to add captions to a video and mentions an SRT file path.
---

# Hormozi Captions

Generate bold, punchy, social-media-ready caption overlays from an SRT file. Output is a
transparent MOV (alpha channel) that drops directly over any video in Premiere, DaVinci,
CapCut, or Final Cut.

## Style

- **Font**: Arial Black, 900 weight, uppercase, ~96px
- **Color**: White (`#FFFFFF`) with hard black stroke via `text-shadow`
- **Keywords**: Gold (`#FFD700`) — user specifies; default candidates are numbers, prices,
  product names, action words
- **Position**: Lower third, `bottom: 320px`, centered
- **Canvas**: 1080×1920 (9:16 portrait)
- **Background**: Transparent (alpha channel)

## Animation

Each caption group pops in with:
- `gsap.fromTo` scale `0.82 → 1`, opacity `0 → 1`, duration `0.13s`, ease `back.out(2)`
- Quick exit: scale `1 → 0.94`, opacity `1 → 0`, duration `0.09s`, ease `power2.in`

## Inputs to gather from the user

1. **SRT file path** — required
2. **Start offset** — seconds of silence at the top before captions begin (default: 0)
3. **Gold keywords** — words/phrases to highlight in gold (user can specify, or you suggest
   numbers, dollar amounts, product names, power words from the transcript)

## Workflow

### Step 1 — Parse the SRT

Read the SRT file. Each cue has an index, a timestamp range (`HH:MM:SS,mmm --> HH:MM:SS,mmm`),
and one or more lines of text.

Convert timestamps to decimal seconds:
```
HH*3600 + MM*60 + SS + mmm/1000
```

### Step 2 — Build caption groups

Break each SRT cue into **2–4 word groups**. Distribute the cue's time proportionally across
its groups. Aim for natural phrase breaks — don't split mid-phrase if you can avoid it.

Example cue: `"No. Septic. So it's probably have to be replaced."` (8.266s → 11.066s, 2.8s total)
→ Group A: `"No. Septic."` (8.266 → 9.30)
→ Group B: `"So it's probably"` (9.30 → 10.10)
→ Group C: `"have to be replaced."` (10.10 → 11.066)

### Step 3 — Identify gold keywords

Scan for gold candidates in each group's text. Mark any word/phrase that matches the user's
keyword list. Wrap them in `<span class="gold">…</span>` in the HTML. Good default keywords
to suggest if the user hasn't specified: dollar amounts, numbers, product names (ADU, etc.),
power words (FREE, NOW, NEVER, etc.).

### Step 4 — Write the HTML

Output to `index.html` in the project directory (HyperFrames requires `index.html`).

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: transparent; }
  body { width: 1080px; height: 1920px; overflow: hidden; }

  #root { position: relative; width: 1080px; height: 1920px; }

  .cg {
    position: absolute;
    left: 0; right: 0;
    bottom: 320px;
    width: 100%;
    text-align: center;
    padding: 0 60px;
    opacity: 0;
  }

  .ct {
    display: inline-block;
    font-family: "Arial Black", "Helvetica Neue", Arial, sans-serif;
    font-weight: 900;
    font-size: 96px;
    line-height: 1.05;
    color: #FFFFFF;
    text-transform: uppercase;
    letter-spacing: -2px;
    text-shadow:
      -5px -5px 0 #000,  5px -5px 0 #000,
      -5px  5px 0 #000,  5px  5px 0 #000,
       0   -5px 0 #000,  0    5px 0 #000,
      -5px  0   0 #000,  5px  0   0 #000;
  }

  .gold { color: #FFD700; }
</style>
</head>
<body>
<div id="root" data-composition-id="root" data-width="1080" data-height="1920" data-duration="TOTAL_DURATION">

  <!-- One .cg div per group, id="cg-0", "cg-1", etc. -->
  <!-- Gold keywords wrapped in <span class="gold">…</span> -->

<script>
(function () {
  var OFFSET = START_OFFSET; // seconds of silence at top
  var G = [
    // { i: 0, s: start_seconds + OFFSET, e: end_seconds + OFFSET },
    // …
  ];

  var tl = gsap.timeline({ paused: true });

  G.forEach(function (g) {
    var el = document.getElementById("cg-" + g.i);
    if (!el) return;
    tl.fromTo(el,
      { opacity: 0, scale: 0.80, transformOrigin: "center center" },
      { opacity: 1, scale: 1,    duration: 0.13, ease: "back.out(2)" },
      g.s
    );
    tl.to(el,
      { opacity: 0, scale: 0.94, duration: 0.09, ease: "power2.in" },
      g.e - 0.09
    );
  });

  window.__timelines = window.__timelines || {};
  window.__timelines["root"] = tl;

  // Auto-play in browser preview; HyperFrames player overrides when rendering
  if (!window.__hyperframes) { tl.play(); }
})();
</script>
</div>
</body>
</html>
```

Set `data-duration` to `last_group_end + OFFSET` (the full composition length in seconds).

### Step 5 — Render

```bash
cd <project-directory>
npx hyperframes render . --format mov --output renders/<name>.mov --fps 30 --quality high
```

The output MOV has a transparent alpha channel — ready to overlay on any video.

### Step 6 — Confirm

Tell the user:
- Output path of the MOV
- File size and duration
- How many caption groups were generated
- Which words were highlighted in gold

## Important notes

- HyperFrames render requires `index.html` in the project directory (not a custom filename).
  If the user wants a descriptive filename, keep `index.html` as the source and name the
  output MOV descriptively.
- The `renders/` directory must exist before running; create it with `mkdir -p renders`.
- If the user says "no captions for the first N seconds," apply that as the `OFFSET`.
- Keep groups to 2–4 words. Short groups = faster reading = more Hormozi energy.
- Numbers, prices, and named entities are almost always good gold candidates.
