# CHANGELOG.md

# Changelog

All notable changes to the BuildX Claude Video Editor should be
documented here.

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
