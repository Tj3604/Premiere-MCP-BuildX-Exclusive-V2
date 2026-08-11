# CHANGELOG.md

# Changelog

All notable changes to the BuildX Claude Video Editor should be
documented here.

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
