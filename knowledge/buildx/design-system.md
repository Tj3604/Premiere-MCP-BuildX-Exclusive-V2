---
status: current
verified: 2026-07-30
source-of-truth: mixed
---

# Design System

Defines how BuildX looks — colour, typography, layout, logo placement, lower thirds, hook
graphics and visual standards. Everything about how BuildX *sounds* lives in `brand.md`.

**Source-of-truth: mixed.**

- **Authoritative** — tokens, typography, layout framework, hook-graphic standards, interview
  conventions. None of this exists anywhere else in the repository.
- **Mirror** — the logo standing rule mirrors `CLAUDE.md`. Marked inline where it appears.
- **Pointer** — asset identities and file paths live in `assets.md`.

> ### ⚠️ Three unresolved decisions
>
> This file contains **three open TODOs** — the gold value, the typeface pair, and whether
> grain texture is permitted. Each has conflicting documented sources, and **no value has
> been guessed.** Sections depending on them are marked. Everything else here is settled and
> safe to use today. See the TODO section at the end and `open-questions.md`.

---

## Colour

### Settled tokens

| Token | Value | Use |
|---|---|---|
| `--black` | `#0B0B0B` | Backgrounds, card fills, text on light |
| `--panel` | `rgba(11,11,11,0.82)` | Semi-opaque panel behind text |
| white | `#FFFFFF` | Default text colour on dark and over footage |

### Gold — **UNRESOLVED, see TODO-DS1**

Gold is the single BuildX accent colour. Its role is settled; **its value is not.** Three
different hex values are in documented, active use:

| Value | Where it is documented | Applies to |
|---|---|---|
| `#D9A441` | Session memory — `buildx-graphics-conventions` | In-edit graphics rendered for Premiere |
| `#D4960A` | Session memory — `feedback_buildx_hook_template`; also the house colour for BuildX Metricool reports | Hook graphics; report PDFs |
| `#FFB81C` | Session memory — `feedback_buildx_hook_render_format` (described as the default accent) | Hook graphics |

Two of these describe the *same* surface (hook graphics) with different values, so at least
one is stale.

**Until this is resolved:** do not hard-code a gold. Take the value from the composition you
are extending, or from `~/Downloads/TM General Graphics`, and record which you used.

### How gold is used

Regardless of the final value, the usage rules are settled:

- **Gold is an accent, never a body colour.** It marks the eyebrow, the payoff word or
  number, and the kicker.
- **`<em>` means gold. It never means italic.** This is a hard convention across every
  BuildX composition — `<em>` in copy is an instruction to the renderer to colour that span
  gold, not to slant it.
- One gold emphasis per beat. If everything is gold, nothing is.
- **Red is reserved.** In interview lower thirds, red replaces gold only when the beat is a
  fraud or warning story. Never decorative.

---

## Typography

### Settled rules

- **Display type is uppercase**, tight — `line-height: 1.05`.
- **Body type is sentence case**, weights 500 and 700 only.
- Eyebrow: **28–32px**, letter-spacing **8px**, uppercase, gold.
- Kicker: **36px**, letter-spacing **3px**, gold.
- Type scale is set per composition, not globally — the hook-graphic scale is documented
  below and is much larger than in-edit graphics because hooks are read at a glance while
  scrolling.

Typography should prioritize readability over strict adherence to a type scale. If a
headline needs to be larger to remain readable on mobile, increase the size rather than
preserving proportional scale.

### Typeface pair — **UNRESOLVED, see TODO-DS2**

| Pair | Where it is documented | Applies to |
|---|---|---|
| **Anton** (display) + **Archivo** 500/700 (body) | Session memory — `buildx-graphics-conventions`; used by every composition currently in `graphics/` | In-edit graphics |
| **Bebas Neue** (display) + **Barlow Condensed** (sub lines) | Session memory — `feedback_buildx_hook_template`, stated as canonical | Hook graphics |

The hook-template note says *"do NOT use the older Anton/Archivo template"* as an unqualified
instruction, but every composition actually built for Premiere uses Anton/Archivo. The likely
reading is that the override is scoped to hook graphics only — **but that is an inference and
has not been confirmed.**

**Until this is resolved:** match the typeface pair of the composition family you are
extending. Do not mix pairs within one graphic.

---

## Layout framework

The standing structure for an in-edit graphic, top to bottom:

```
┌─────────────────────────────────┐
│  EYEBROW            (gold, 8px tracking, uppercase)
│                                 
│  DISPLAY HEADLINE   (uppercase, line-height 1.05)
│                                 
│  Content            (stat, checklist, comparison, diagram)
│                                 
│  BuildX. Just build baby.   (gold kicker, 3px tracking)
└─────────────────────────────────┘
```

Not every graphic uses all four rows — a full-frame stat card may be headline and number
only. The order never changes.

### Spacing — 9:16

| Property | Value |
|---|---|
| Side margins | **51px** |
| Corner radius | **26px** |
| Background | `transparent` on `html, body` — required for alpha |

### Motion

| Property | Value |
|---|---|
| Easing | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| Entrance | Opacity + `translateY` — the "rise" |
| Sequencing | Staggered, not simultaneous |

**Timing is content-driven, not decorative.** A reveal must land **on or after** the moment
the information is spoken — never before. This is a hard rule with a real failure history:
several graphics shipped revealing figures before they were said, and had to be re-rendered
and re-placed. See `production-workflow.md` for the verification method.

---

## Variety

Ten identical cards is a failure mode, not a house style. Mix the formats:

- Card overlays (lower third, corner, side panel)
- Full-frame animated stat reveals
- Building checklists — items appearing as they are named
- Comparisons — two values resolving against each other
- Diagrams — floor plans, lot layouts, before/after positions

Covering the footage is acceptable when the graphic *is* the content. The constraint is
variety across a batch, not restraint within a single graphic.

---

## Graphics over b-roll

**Never put text on a solid card over b-roll.** A solid panel hides the build, which is the
thing the viewer came to see.

Instead: **bake a full-frame semi-transparent black wash into the graphic itself**, and let
the footage read through it. The documented reference implementation uses a Black Video
layer at approximately **86% opacity**.

The wash is part of the composition, not a Premiere layer added afterwards — that keeps the
graphic self-contained and reusable.

---

## Logo placement

> *Mirrors the standing rule in `CLAUDE.md`. The rule lives there — edit there, not here.
> This section adds the per-format table and the derivation, which `CLAUDE.md` does not
> carry.*

**Every BuildX edit gets the white BuildX logo on V3.** Applied by default, without being
asked. Asset identity and source path are in `assets.md`.

### Per-format values

| Sequence format | Position (normalised) | Scale | Placement |
|---|---|---|---|
| **1080 × 1920** (9:16) | `[0.5, 0.1530]` | **40** | Top centre — safe-zone compliant |
| **1728 × 3072** (9:16) | `[0.5, 0.1530]` | **64** | Top centre — `40 × 1.6` |
| **1920 × 1080** (16:9 studio interview) | `[0.905, 0.093]` | **24** | **Top right** — *not yet checked against safe zones* |

> **Changed 2026-08-11.** The 9:16 values were `[0.5, 0.0385417]` / scale 54, which put the
> logo's top edge at **−31px** — cropped off frame, and squarely under the iPhone Dynamic
> Island. The top 192px of a 9:16 frame is title-safe. See `safe-zones.md` for the
> derivation; do not revert without reading it.

### Deriving a new format

Premiere's Effect Controls shows **pixel** values; the scripting API takes **normalised**
coordinates. Convert with `x / width, y / height`.

The 9:16 reference is **x 540, y 294, scale 40%** in a 1080 × 1920 sequence:

```
x:      540 / 1080  = 0.5
y:      294 / 1920  = 0.1530      ← logo top edge lands at 216px, clear of the 192px title-safe line
scale:   40 × (sequence_width / 1080)
```

The y value is derived, not chosen: the logo asset is 1000 × 389, so at scale 40 it renders
156px tall. Centre = `192 (safe line) + 24 (breathing room) + 156/2` = **294px**.

Because the normalised position is resolution-independent within one aspect ratio, **any
9:16 sequence uses the same position** — only the scale changes: `40 × (1728 / 1080) = 64`. ✓

**16:9 is a separate regime**, not a derivation — top right, roughly 11% of frame width, so
the logo stays clear of both faces in a two-shot.

### Applying it

- Use **`set_param_value`** with `componentName: "Motion"` and `paramName: "Position"` /
  `"Scale"`.
- **Do not use `set_clip_position`, `set_clip_scale` or `set_uniform_scale`** — all three are
  among the tools that report success and do nothing. See `premiere-gotchas.md`.
- **End the logo where a full-frame CTA graphic begins**, so the two never stack.
- Verify visually — tool success is not proof. See `production-workflow.md`.

---

## Lower thirds and interview cards

For 16:9 studio-interview edits:

| Property | Value |
|---|---|
| Position | Lower third, **left-aligned** |
| Rule | **10px left rule** |
| Rule colour | Gold normally; **red** when the beat is a fraud or warning story |
| Clearance | Positioned so **both faces stay clear** in a two-shot |

The left alignment and lower-third placement exist for the same reason as the top-right
logo: a two-shot has two people in it, and neither can be covered.

Naming rules for anything appearing in a lower third are in `people.md` — **never put a name
on screen that was inferred rather than confirmed.**

---

## Hook graphics

Standalone full-frame graphics composited over footage — the scroll-stopping opening card.
They are a distinct family with their own scale and structure.

Hook graphics are a specialized graphic family and intentionally do not inherit the standard
in-edit layout framework.

### Canonical structure

```
┌──────────────────────────────────┐
│ ▔▔▔▔▔▔  top bar (gold, scaleX slide-in)
│                                  
│  LINE 1        210px  gold       ← main block
│  LINE 2        176px  white      
│  LINE 3        176px  white      
│  LINE 4        260px  gold       
│                                  
│  ⋀⋁⋀⋁⋀  jagged gold divider      
│                                  
│  Sub line 1     96px  white      ← sub block
│  Sub line 2     96px  gold       
│                                  
│         [ logo zone — 320px ]    
└──────────────────────────────────┘
```

| Property | Value |
|---|---|
| Canvas | **1080 × 1920**, `background: transparent` |
| Layout | `flex-direction: column; justify-content: space-between` |
| Padding | `72px 56px 320px 80px` |
| Bottom padding | **320px** — deliberately large, reserving a clear logo zone between the sub text and the frame edge |
| Structure | Main block (4 stacked lines) → jagged gold divider → sub block (2 lines) |
| Decorators | Top bar, jagged left edge (`clip-path`), jagged bottom edge, halftone dots, streak flash |

### Hard rules

- **No eyebrow or label slot** — hooks do not use the in-edit layout framework.
- **No viewport scaler div** — the body is the canvas.
- **No checkerboard preview background.** The template has `background: transparent` baked
  in; do not add it back.
- **No replay button.**
- **No shake animation.**
- Substitute **copy only.** Match class names, keyframe names and decorator elements exactly
  when creating a new hook from the template.

### Rendering

| Rule | Why |
|---|---|
| **Render as MOV, never MP4** | Hooks composite over footage and need an alpha channel. MP4 has none. |
| **Drop any resolution flag when rendering alpha** | Alpha renders at the composition's native resolution, which is already 1080 × 1920 |
| **Render to a new unique filename every time** | Premiere links media by path; overwriting a linked file loses the frame reference. See `production-workflow.md`. |

### Grain texture — **UNRESOLVED, see TODO-DS3**

Two documented sources directly contradict each other:

| Source | Says |
|---|---|
| `feedback_buildx_hook_render_format` | **Never** include a grain overlay in any hook. The `.grain` SVG `fractalNoise` uses `mix-blend-mode: overlay`, which renders as a **white wash on a transparent background**, and massively inflates ProRes size — 1.9 GB vs 74 MB observed. |
| `feedback_buildx_hook_template` | Grain SVG texture is listed as one of the canonical template's decorative elements. |

**Until this is resolved:** the render-format note gives a concrete, reproducible technical
failure, so **omit grain from alpha renders**. If grain is wanted as a look, it needs a
different implementation than `mix-blend-mode: overlay` on transparent.

---

## Thumbnails

Thumbnails inherit the hook-graphic scale and structure — very large display type, high
contrast, gold on the payoff word. They are read at a fraction of full size, so the same
rule applies harder: **one idea, one emphasis.**

No thumbnail-specific dimensions or safe areas are documented in this repository yet. Until
they are, derive from the hook canvas and keep critical text clear of the outer 10%.

---

## Scope of this document

This file defines visual presentation only.

- Brand voice and messaging belong in `brand.md`.
- Asset identities, source paths and the composition catalogue belong in `assets.md`.
- Render, import and placement procedure belongs in `production-workflow.md`.
- Premiere tool behaviour and failures belong in `premiere-gotchas.md`.
- Caption styling policy belongs in `captions.md` and inherits from this file.

---

## TODOs

**TODO-DS1 — Which gold is canonical?**
`#D9A441`, `#D4960A` or `#FFB81C`. Two of the three are documented for the same surface
(hook graphics), so at least one is stale. Is there one BuildX gold, or is it legitimately
context-dependent — one for in-edit graphics, another for hooks and reports?
*Blocks:* every new graphic. Highest-impact open question in the knowledge base.

**TODO-DS2 — Anton + Archivo, or Bebas Neue + Barlow Condensed?**
The hook-template note reads as a blanket override, but every composition in `graphics/`
uses Anton + Archivo. Does the override apply only to hook graphics, or to all BuildX
graphics?
*Blocks:* every new graphic.

**TODO-DS3 — Is grain permitted?**
One source bans it with a reproducible technical failure; another lists it as a required
decorator. If grain is wanted, it needs an implementation that survives an alpha render.
*Blocks:* hook graphics only.

**TODO-DS4 — Thumbnail specifications.**
No dimensions, safe areas or platform variants are documented anywhere. Worth capturing once
so thumbnail production becomes standardized across projects.
*Blocks:* thumbnail work only.

All indexed in `open-questions.md`.

---

## Sources

| Content | Origin |
|---|---|
| Tokens, layout framework, easing, margins, `<em>` = gold, b-roll wash, variety | Session memory — `buildx-graphics-conventions` |
| Logo standing rule, normalised-coordinate conversion, `set_param_value` requirement | `CLAUDE.md` — standing rule section; session memory — `buildx-logo-overlay-rule` |
| 1728 × 3072 logo values (Position, Scale 86.4) — verified live | `SHORTS-HANDOFF.md` — graphics state |
| 16:9 logo top-right; interview lower-third conventions | Session memory — `buildx-graphics-conventions` |
| Hook template structure, sizes, padding, decorators, prohibitions | Session memory — `feedback_buildx_hook_template` |
| Hook render format, alpha requirement, grain prohibition | Session memory — `feedback_buildx_hook_render_format` |
| Reveal-after-spoken-word rule and its failure history | `SHORTS-HANDOFF.md` — graphics timing corrections |
| Style summary as applied on a real build | `SHORTS-HANDOFF.md` — style / branding conventions |

Session-memory files are outside this repository, in
`~/.claude/projects/-Users-thomasmartell-Downloads/memory/`. They are not version-controlled
and do not load in a session opened at this project's own directory — which is the reason
this file exists. See `open-questions.md` (question 5) for their planned disposition.
