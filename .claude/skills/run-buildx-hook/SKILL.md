---
name: run-buildx-hook
description: Preview, screenshot, run, or visually verify any buildx-hook HTML file. Use when asked to screenshot a hook, check what a hook looks like, preview a generated hook, verify copy in a hook, or take a screenshot of a buildx hook animation.
---

Buildx hook files are standalone CSS-animated HTML files (9:16 format) served from `~/Downloads` at `localhost:5500`. The driver takes a headless screenshot at any point in the 6-second animation.

## Prerequisites

One-time browser install (already done if `~/.playwright` caches exist):

```bash
npx playwright install chromium
```

## Agent path — screenshot a hook file

Run from `~/Downloads`:

```bash
node .claude/skills/run-buildx-hook/driver.mjs <filename.html> [time_ms]
```

- `<filename.html>` — any `buildx-hook-*.html` in `~/Downloads`
- `[time_ms]` — milliseconds into the animation (default: `3500` = all copy visible)
- Output: `~/Downloads/<basename>-preview.png`

Key animation milestones (all copy is in by t=3500):

| time_ms | what's visible |
|---------|----------------|
| 1000 | streak flash only |
| 2000 | eyebrow + Line A + gold underline |
| 3500 | all four slots (eyebrow, line-a, line-b, secondary) |
| 5500 | master fade starting |

The driver auto-starts `python3 -m http.server 5500` from `~/Downloads` if the server isn't already running.

Example:

```bash
cd ~/Downloads
node .claude/skills/run-buildx-hook/driver.mjs buildx-hook-adu-test.html 3500
# → buildx-hook-adu-test-preview.png
```

## Human path

Open `http://localhost:5500/buildx-hook-template.html` in a browser (Live Server in VS Code keeps port 5500 up). The Replay button at the bottom restarts the animation.

## Gotchas

- **Google Fonts don't load in headless Chromium** — the fonts fall back to system fonts. Layout still works but Anton/Archivo/Space Mono won't render as designed. For copy verification this is fine; for visual QA before shipping, open in a real browser.
- **`npx playwright` resolves to the globally cached version**, not a project-local install. If `npx playwright --version` fails, run `npm install -g playwright` then `npx playwright install chromium`.
- **Port 5500 is usually held by VS Code Live Server** (a Python process). The driver checks for it before starting a new one — safe to run while VS Code is open.
- **`--wait-for-timeout` is wall-clock, not animation time** — if the machine is under load, the screenshot may lag slightly behind the expected frame. Add 200–300ms to your target if you're getting a frame too early.
- **The template uses `animation: X s linear 1 both`** — each element animates once (fill-mode `both`). After 6s the last frame is held. Screenshots at t > 6000 will always show the fully-held final state.

## Troubleshooting

**`Error: Executable doesn't exist at .../chrome-headless-shell`**
→ Run `npx playwright install chromium`

**`File not found: ~/Downloads/foo.html`**
→ Pass just the filename (e.g. `buildx-hook-template.html`), not a full path

**Screenshot is blank / all black**
→ The server returned a 404. Confirm the file exists in `~/Downloads` and the filename matches exactly.

**Server did not start in time**
→ Check if another process already owns port 5500: `lsof -ti :5500`. Kill it or pass a different port to `http.server` and update the URL manually.
