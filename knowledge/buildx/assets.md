---
status: current
verified: 2026-07-30
source-of-truth: mixed
---

# Assets

Defines where BuildX assets live — brand-permanent files, media libraries, the composition
catalogue, and the conventions governing them.

**Source-of-truth: mixed.**

- **Authoritative** — the composition catalogue, the prefix convention, the versioning rule
  and the identifier warning. None of this exists elsewhere in the repository.
- **Mirror** — asset specifications recorded during a project build. Marked inline.
- **Pointer** — how assets are used on screen belongs to `design-system.md`; how they are
  placed belongs to `production-workflow.md`.

---

## ⚠️ Premiere identifiers are not durable

**Project item IDs and bin IDs are per-project and per-session. Never reuse a recorded ID.**

Treat every identifier as ephemeral unless it is resolved again in the current project.

They appear in project documents in tables that read like a permanent registry. They are
not. An ID that resolved to the logo in one project will resolve to something else — or
nothing — in another.

**Always resolve an asset by name at the point of use:** search the project for it, and
import it from its canonical source path if it is not already there.

This is the single most likely way to place the wrong media on a timeline while every tool
call reports success.

---

## Brand-permanent assets

*Mirrors specifications recorded during a project build.*

### The BuildX logo

| Property | Value |
|---|---|
| Appears in project panels as | `BuildX Logo WHITE.PNG.png` |
| Canonical source | Dropbox → `BuildX/Assets (BuildX)/BuildX Logos/BuildX Logo Transparent/` |
| Format | Transparent PNG, white |
| Usage | **V3 on every edit**, applied by default |

Placement values per sequence format — position, scale, and how to derive a new format — are
in `design-system.md`. Application notes are in `production-workflow.md`.

These assets are treated as reusable brand resources rather than project-specific media.

### The standard end card

| Property | Value |
|---|---|
| Duration | **5.00 seconds** |
| Native resolution | **1080 × 1920** |
| Fully revealed by | ~3.7 seconds |
| Scaling | **~160%** in a 1728 × 3072 sequence |
| Usage | Appended to **every** short, no exceptions |

The card carries the home-tour offer and a link direction to the BuildX site. The CTA policy
governing it is in `brand.md`: **never author a new CTA; always append this one.**

> ⚠️ **The card contains schedule text.** Any change to tour timing makes every previously
> exported short carry stale information, and requires the card to be re-cut rather than
> edited around. **Confirm the card's current wording before a batch ships** rather than
> assuming a version from an earlier project is still correct. See TODO-A2.

---

## Media libraries

### Vertical b-roll library

The primary owned-footage library for short-form work.

| Property | Value |
|---|---|
| Location | BuildX media server → `Media/BuildX Broll` |
| Structure | ADUs and drone · exterior · interior · home tours |
| Format | **Native 9:16 at 1728 × 3072** |
| Reframing | **None required** — shot for delivery |

Shot natively in the delivery aspect ratio, so it is preferable to cropping a horizontal
source. Selection doctrine is in `broll.md`.

### Reference composition library

A library of roughly 54 HTML compositions kept outside the repository, used as the visual
reference from which the BuildX house style was derived.

Use it to match an existing look rather than inventing one — and, while the colour and
typeface questions in `design-system.md` remain open, as the reference for which values are
actually in use.

### Canonical hook template

A single HTML file, kept outside the repository, that is the starting point for every new
hook graphic. Its structure, type scale, padding and decorators are documented in
`design-system.md`.

**Substitute copy only.** Match class names, keyframe names and decorator elements exactly.

---

## Volumes

| Volume | Role |
|---|---|
| **BuildX media server** | Current project media and the b-roll library |
| **Secondary project volume** | Earlier project media |

Both are external volumes. **A project referencing either will go offline when the volume is
not mounted**, and Premiere will report missing media rather than the real cause. Confirm the
volume is mounted before diagnosing anything else.

Specific project paths belong in the project handoff documents, not here.

---

## Composition catalogue

**42 compositions** currently live in `graphics/`, grouped by project prefix. This catalogue
exists to aid discovery rather than replace opening the composition when its behavior
matters.

### Prefix convention

| Prefix | Project | Count | Confidence |
|---|---|---|---|
| `ht-` | Home Tour | 12 | Confirmed |
| `bp-` | BuildX Process | 8 | Confirmed |
| `nh-` | Senior-care cost comparison | 6 | **Inferred from content** |
| `jt-` | A permitting / public-record story | 6 | **Inferred from content** |
| `broll-` | Synthetic b-roll — built where no footage existed | 5 | Confirmed |
| `faq-` | FAQ shorts | 3 | Confirmed |
| *(project name)* | One-off, named for its subject | 2 | — |

Graphic compositions within a project are numbered `-g1`, `-g2`, … in build order, followed
by a short descriptive slug.

### The compositions

| Project | Compositions |
|---|---|
| **Home Tour** | `ht-g1-price` · `ht-g2-payments` · `ht-g3-fourofsix` · `ht-g4-timeline` · `ht-g5-sixseven` · `ht-g6-45k` · `ht-g7-floorplan` · `ht-g8-checklist` · `ht-g9-podcast` · `ht-g10-ownership` · `ht-g11-x9transition` · `ht-g12-gassteps` |
| **BuildX Process** | `bp-g1-entry` · `bp-g2-service-area` · `bp-g3-zoom-call` · `bp-g4-stakeholders` · `bp-g5-plans-free` · `bp-g6-money-to-start` · `bp-g7-fixed-price` · `bp-g8-100-days` |
| **Senior-care comparison** | `nh-g1-per-day` · `nh-g2-memory-care` · `nh-g3-comparison` · `nh-g4-alone` · `nh-g5-at-home` · `nh-g6-collision` |
| **Public-record story** | `jt-g1-public-record` · `jt-g2-town-must-show` · `jt-g3-permit-question` · `jt-g4-escalation` · `jt-g5-story-stat` · `jt-g6-recourse` |
| **Synthetic b-roll** | `broll-exterior` · `broll-taxmath` · `broll-utilities` · `broll-watermeter` · `broll-westfield` |
| **FAQ shorts** | `faq-captions` · `faq-cards` · `faq-cta` |
| **Standalone** | `norwell-adu-price` · `alpha-test` |

> **No composition carries a description.** Each folder contains only its `index.html`, so
> every purpose above is inferred from the folder name. Before reusing one, open it — see
> TODO-A3.

`alpha-test` is the reference transparent-overlay composition and the working template for a
new alpha graphic.

The `broll-*` set is worth noting on its own: five compositions built specifically to cover
beats no camera captured — a tax calculation, a utility run, a water meter, an exterior, a
location reference. They are the precedent for the rule in `broll.md` that **a purpose-built
graphic beats a substitute shot.**

---

## Versioning

**Versions live in the rendered filename, not in the composition folder.**

Confirmed by inspection: no composition folder carries a version suffix, while rendered
output does — several compositions have `-v2` and one has `-v3`.

```
graphics/ht-g3-fourofsix/index.html        ← one composition, corrected in place
renders/ht-g3-fourofsix_ProRes4444.mov     ← original render
renders/ht-g3-fourofsix-v2_ProRes4444.mov  ← corrected timing
renders/ht-g3-fourofsix-v3_ProRes4444.mov  ← corrected again
```

The render filename therefore becomes the authoritative identifier for what actually appeared
on a timeline.

### Why

**Premiere links media by file path.** Re-rendering over a path Premiere already has linked
makes it serve cached media or lose the frame reference entirely. So a revision must be
written to a **new filename** — while the composition itself is simply corrected in place,
since it is the source, not the link.

### Consequences

- **The composition on disk reflects the newest version only.** A composition folder cannot
  tell you which render is on a timeline; the render filename can.
- **A re-render is usually a different duration.** A retimed graphic will not fit the clip it
  replaces — check the new length before placing it.
- **Older renders stay in the project bin unused.** They are not automatically cleaned up,
  and `delete_project_item` does not work — see `premiere-gotchas.md`.

Full procedure is in `production-workflow.md`.

---

## Rendered output

`renders/` holds the output of every composition — currently 68 files.

| Format | Use |
|---|---|
| **ProRes 4444 `.mov`** | Overlays. Carries a real alpha channel |
| **MP4** | Full-frame graphics with no transparency |

An overlay render must come from a composition with a transparent background, or the result
is an opaque rectangle that covers the footage. Alpha WebM never imports — see
`premiere-gotchas.md`.

---

## What is not in version control

| Path | Contents |
|---|---|
| `footage/` | Source video |
| `renders/` | All rendered graphics |
| `exports/` | All delivered files |
| `transcripts/` | All transcripts |

Also excluded by extension: Premiere project files, all video and audio formats, and **all
image formats** — which means **PNG and JPG assets cannot be committed to this repository at
all.** Anything referenced by a composition as an image must live outside it or be embedded.

**A fresh clone contains the composition source but none of the generated media.** Everything
in `renders/` is reproducible from `graphics/`; nothing in `footage/`, `exports/` or
`transcripts/` is reproducible without the source media.

---

## Scope of this document

This file records where assets live and how they are named.

- How assets appear on screen — position, scale, colour — belongs in `design-system.md`.
- How they are rendered, imported and placed belongs in `production-workflow.md`.
- Which footage to choose for a beat belongs in `broll.md`.
- Tool behaviour around importing and filing belongs in `premiere-gotchas.md`.
- Project-specific item IDs, bin IDs and sequence paths belong in the project handoff
  documents — **and are not durable, see the warning above.**

---

## TODOs

**TODO-A1 — Do the brand-permanent assets have a durable home?**
The logo lives in cloud storage and the end card has been referenced from a desktop path.
Neither is a stable location a future project can rely on, and neither can be committed to
this repository because image and video formats are excluded. A single canonical
brand-assets location — with the logo, the end card and the hook template together — would
remove a recurring point of failure.
*Blocks:* nothing today. Highest practical risk in this file.

**TODO-A2 — Does the end card contain information that goes stale?**
It carries schedule text. If tour timing changes, every short ever exported carries stale
information and the card must be re-cut. Confirm the current wording, and whether a
schedule-free variant would be more durable for evergreen content.
*Blocks:* nothing today. Worth settling before a large batch ships.

**TODO-A3 — Should each composition carry a description?**
42 compositions, none with any description — every purpose in the catalogue above is inferred
from a folder name. Three lines per composition (project · what it renders · superseded by)
would make reuse possible without opening each one, and would let this catalogue be
maintained rather than re-derived.
*Blocks:* nothing today. Compounding cost as the library grows.

**TODO-A4 — Document the canonical meaning of every project prefix, including the convention
for introducing new ones.**
Two current prefixes are inferred from composition names rather than documented. Recording
every prefix, and the rule for adding one, would make the catalogue reliable rather than
best-guess and would keep it correct as the library grows.
*Blocks:* nothing today.

All indexed in `open-questions.md`.

---

## Sources

| Content | Origin |
|---|---|
| Logo canonical path and usage rule | Session memory — `buildx-logo-overlay-rule` |
| End card duration, resolution, reveal point, scaling and content | `SHORTS-HANDOFF.md` — assets table |
| Identifiers are per-project | `SHORTS-HANDOFF.md` — assets table, read against Premiere's actual behaviour |
| B-roll library location, structure and native format | Session memory — `buildx-graphics-conventions` |
| Reference composition library; canonical hook template | Session memory — `buildx-graphics-conventions`, `feedback_buildx_hook_template` |
| Composition catalogue, counts and prefixes | `graphics/` — direct inspection, 2026-07-30 |
| Versioning lives in the render filename | `graphics/` and `renders/` — direct inspection, 2026-07-30 |
| Never re-render over a linked path | `SHORTS-HANDOFF.md`; session memory — `feedback_premiere_unique_filenames` |
| Render formats and counts | `renders/` — direct inspection, 2026-07-30 |
| Exclusions from version control | `.gitignore` |

Specific project item IDs, bin IDs and sequence paths remain in the project handoff
documents, unmodified. They are deliberately **not** reproduced here.
