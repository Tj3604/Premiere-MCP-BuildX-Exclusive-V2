---
name: run-buildx-hook
description: Preview, screenshot, run, or visually verify any buildx-hook HTML file. Use when asked to screenshot a hook, check what a hook looks like, preview a generated hook, verify copy in a hook, or take a screenshot of a buildx hook animation.
---

Buildx hook files are standalone CSS-animated HTML files (9:16 format), served at `localhost:5500` from whichever folder the hook is found in. The driver takes a headless screenshot at any point in the 6-second animation.

## Where hooks are found

A bare filename is searched for in this order — the first hit wins, and that folder becomes the server root:

1. `$BUILDX_HOOKS_DIR` — explicit override
2. `hooks/` in this repo — the templates that ship with a clone
3. `~/Downloads/TM Hooks/` — the local working library
4. `~/Downloads/`

A path (absolute or relative) is used as-is and skips the search. Nothing is hardcoded to a
particular machine: a fresh clone works against `hooks/` with no setup.

## Prerequisites

One-time browser install (already done if `~/.playwright` caches exist):

```bash
npx playwright install chromium
```

## Agent path — screenshot a hook file

Run from the repo root:

```bash
node .claude/skills/run-buildx-hook/driver.mjs <filename.html> [time_ms]
```

- `<filename.html>` — any `buildx-hook-*.html` in one of the search folders above, or a full path
- `[time_ms]` — milliseconds into the animation (default: `3500` = all copy visible)
- Output: `<basename>-preview.png`, written next to the hook

Key animation milestones (all copy is in by t=3500):

| time_ms | what's visible |
|---------|----------------|
| 1000 | streak flash only |
| 2000 | eyebrow + Line A + gold underline |
| 3500 | all four slots (eyebrow, line-a, line-b, secondary) |
| 5500 | master fade starting |

The driver auto-starts `python3 -m http.server 5500` from the folder the hook was found in, if the server isn't already running.

Example:

```bash
# ships with the repo — works on a fresh clone
node .claude/skills/run-buildx-hook/driver.mjs buildx-hook-gfa-vs-sqft.html 3500
# → hooks/buildx-hook-gfa-vs-sqft-preview.png

# a hook from your own library, by name or by path
node .claude/skills/run-buildx-hook/driver.mjs buildx-hook-adu-test.html 3500
BUILDX_HOOKS_DIR=~/some/other/folder node .claude/skills/run-buildx-hook/driver.mjs my-hook.html
```

## Human path

Open `http://localhost:5500/buildx-hook-template.html` in a browser (Live Server in VS Code keeps port 5500 up). The Replay button at the bottom restarts the animation.

## Gotchas

- **Google Fonts don't load in headless Chromium** — the fonts fall back to system fonts. Layout still works, but any webfont the template specifies won't render as designed. For copy verification this is fine; for visual QA before shipping, open in a real browser.
- **`npx playwright` resolves to the globally cached version**, not a project-local install. If `npx playwright --version` fails, run `npm install -g playwright` then `npx playwright install chromium`.
- **Port 5500 is usually held by VS Code Live Server** (a Python process). The driver only reuses an existing server if it actually serves the hook you asked for; otherwise it starts its own on the next free port (5501, 5502, …). A server rooted at a *different* folder answers 404, which would otherwise reach the screenshot as a blank frame rather than an error.
- **`--wait-for-timeout` is wall-clock, not animation time** — if the machine is under load, the screenshot may lag slightly behind the expected frame. Add 200–300ms to your target if you're getting a frame too early.
- **Previews render at the hook's native 1080x1920.** Hooks are authored on a fixed-size canvas, so a smaller viewport crops the frame and hides copy that runs wide — the exact failure these screenshots exist to catch. Override with `BUILDX_HOOK_VIEWPORT="600,1067"` if you want a small file and don't care about the right-hand third.
- **The template uses `animation: X s linear 1 both`** — each element animates once (fill-mode `both`). After 6s the last frame is held. Screenshots at t > 6000 will always show the fully-held final state.

## Troubleshooting

**`Error: Executable doesn't exist at .../chrome-headless-shell`**
→ Run `npx playwright install chromium`

**`Hook not found: foo.html`**
→ The error lists every folder that was searched. Either drop the file into one of them, point
`BUILDX_HOOKS_DIR` at the folder holding it, or pass the full path.

**Screenshot is blank / all black**
→ The server returned a 404. Confirm the filename matches exactly, and that a stale `http.server` from a *different* folder isn't already holding port 5500 (`lsof -ti :5500`).

**Server did not start in time**
→ Check if another process already owns port 5500: `lsof -ti :5500`. Kill it or pass a different port to `http.server` and update the URL manually.
