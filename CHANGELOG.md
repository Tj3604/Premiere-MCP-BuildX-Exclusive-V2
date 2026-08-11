# CHANGELOG.md

# Changelog

All notable changes to the BuildX Claude Video Editor should be
documented here.

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
