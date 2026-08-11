---
status: current
verified: 2026-08-11
source-of-truth: authoritative
---

# Safe Zones

Where logos, text, lower thirds and graphics may be placed, and which regions the platform
will cover with its own interface. Resolves **TODO-C1** in `captions.md` and supplies the
geometry `design-system.md` assumes but never stated.

**Source:** BuildX *Social Video Safe Zones* reference graphic, supplied 2026-08-11.

> **The one-line rule:** keep every logo, every word and every face inside the **green safe
> zone**. It is the only region guaranteed visible on all platforms.

---

## The three bands

| Band | Meaning | Rule |
|---|---|---|
| **Green — safe zone** | Guaranteed visible everywhere | **All** logos, text, faces and important graphics go here |
| **Blue — edge safe** | May be cropped on some devices, or covered by platform UI | Secondary elements only, at your own risk |
| **Red — title / control safe** | Top may carry titles and profile info; bottom may carry player controls, captions and buttons | **Nothing important.** Assume it is covered |

---

## Per-platform values

As stated on the reference graphic:

| Platform | Frame | Top (title safe) | Bottom (control safe) | Sides (edge safe) | Stated safe zone |
|---|---|---|---|---|---|
| **YouTube** | 1920 × 1080 (16:9) | 250px (12%) | 250px (12%) | 250px (12%) | 1420 × 800 (83% × 74%) |
| **Instagram** | 1080 × 1350 (4:5) | 135px (10%) | 135px (10%) | 108px (10%) | 1080 × 1080 (100% × 80%) |
| **TikTok** | 1080 × 1920 (9:16) | 192px (10%) | 192px (10%) | 108px (10%) | 1080 × 1536 (100% × 80%) |

### Working values for BuildX 9:16 — use these

BuildX short-form is **1080 × 1920**, so the TikTok column governs. Treating all four
insets as binding:

| Boundary | Pixel | Normalised |
|---|---|---|
| Top edge of safe zone | **y = 192** | 0.1000 |
| Bottom edge of safe zone | **y = 1728** | 0.9000 |
| Left edge of safe zone | **x = 108** | 0.1000 |
| Right edge of safe zone | **x = 972** | 0.9000 |
| Usable area | **864 × 1536** | |

**Right side needs the most care.** On a 9:16 feed the action rail — profile, like, comment,
share, sound — sits on the right and runs deep into the frame. Left-aligned layouts are
safer than centred ones for anything wordy.

> ⚠️ **Two arithmetic inconsistencies on the source graphic**, recorded rather than
> silently corrected:
>
> 1. **YouTube** — 250px top + 250px bottom on a 1080-tall frame leaves 580px, not the
>    stated 800px. The stated 74% implies roughly 140px top and bottom instead.
> 2. **Instagram and TikTok** — both state a safe-zone width of **100%** while also
>    specifying a **108px edge safe** on each side. Those cannot both hold.
>
> **Until confirmed, take the conservative reading**: honour the 108px edge safe, giving
> **864px** of usable width, not 1080. Tracked as TODO-SZ1.

---

## Compliance of the current BuildX system

Checked against the values above. **Three placements currently sit outside the safe zone.**

| Element | Current | Safe-zone requirement | Status |
|---|---|---|---|
| **Logo** | ✅ **RESOLVED** — see below | top edge ≥ y 192 | ✅ fixed 2026-08-11 |
| **Side margins** | **51px** (`design-system.md`) | ≥ **108px** | ❌ **57px short each side** |
| In-edit card top | 210–250px | ≥ 192px | ✅ clears, tight at 210 |
| Lower third | block top 1200px, ends ≈1350px | ≤ 1728px | ✅ |
| Hook text block | top 520px | 192–1728 | ✅ |
| Hook bottom padding | 320px reserved → content ends ≈1600px | ≤ 1728px | ✅ |

### What this means

- **The 51px side margin predates this spec** and is half what the edge safe asks for.
  Raising it to 108px narrows every card by 114px, which will reflow existing headline
  sizes. See TODO-SZ3.

---

## Logo placement — RESOLVED 2026-08-11

**The reason, stated plainly: on iPhone the Dynamic Island sits at the top of the screen and
was covering the BuildX logo.** That is what the title-safe band exists to protect against.

The logo asset is **1000 × 389** native. At scale 40 it renders **400 × 156px**.

| Rule | Logo top edge | Verdict |
|---|---|---|
| `[0.5, 0.0385417]`, scale 54 *(old standing rule)* | **−31px** | Off the top of the frame entirely — cropped before the island is even a factor |
| `[0.5, 0.062]`, scale 40 *(revised batch value)* | **41px** | Deep inside the island / title band |
| **`[0.5, 0.1530]`, scale 40** ✅ | **216px** | **24px clear of the 192px safe line** |

### The rule

> **9:16 logo: Position `[0.5, 0.1530]`, Scale 40.**
> Top edge lands at 216px — inside the safe zone with 24px of breathing room, rather than
> flush against the line.

Horizontal is unaffected: 400px wide centred spans x 340–740, comfortably inside the
108–972 safe band.

**The normalised y is resolution-independent within 9:16**, so `0.1530` carries to any 9:16
frame; only scale changes with resolution. Derive scale as
`40 × (sequence_width / 1080)` — see `design-system.md`.

**Supersedes** the value in `CLAUDE.md` and the per-format table in `design-system.md`, both
of which have been updated.

> ⚠️ **The end-card asset carries its own logo at the top of frame.** `CTA Graphics 9x16.mp4`
> is a pre-made asset and has not been checked against the safe zone. If its logo sits above
> 192px it has the same problem, and it cannot be fixed by repositioning — the asset itself
> would need rebuilding. Tracked as TODO-SZ4.

---

## Applying it

- **Design to the green zone, not the frame.** A composition that fills 1080 × 1920 is not
  wrong, but nothing that must be read may fall outside 108–972 × 192–1728.
- **One placement for all platforms.** A short ships everywhere unless there is a reason not
  to (`editorial.md`), so use the intersection rather than a per-platform variant.
- **Check before export**, not after — this belongs in the QA gate in
  `production-workflow.md`.
- **Test on device.** The graphic's own closing note: mobile screens vary, and what looks
  right on one phone can crop on another.

---

## Scope of this document

- Colour, type, logo scale and layout values belong in `design-system.md`; this file governs
  only *where* they may sit.
- Caption policy belongs in `captions.md`; this file supplies the geometry it references.
- Export and QA procedure belongs in `production-workflow.md`.

---

## TODOs

**TODO-SZ1 — Confirm the safe-zone width for portrait formats.**
The graphic states 100% width and a 108px edge safe simultaneously. Confirm whether portrait
safe zones are full-width or inset by 108px. The conservative 864px reading is in use
meanwhile.
*Blocks:* final side-margin value.

**~~TODO-SZ2~~ — RESOLVED 2026-08-11.** Logo moved to `[0.5, 0.1530]`, scale 40, putting its
top edge at 216px — clear of the iPhone Dynamic Island and the platform title band. See
"Logo placement" above.

**TODO-SZ4 — Does the end-card asset clear the safe zone?**
`CTA Graphics 9x16.mp4` carries its own logo at the top of frame and has not been measured.
Unlike the overlay logo this cannot be fixed by repositioning; the asset would need
rebuilding.
*Blocks:* nothing today. Every short ends on this card, so if it is affected, it is affected
14 times over.

**TODO-SZ3 — Raise the side margin from 51px to 108px?**
`design-system.md` specifies 51px. Edge safe asks for 108px. Changing it reflows every
existing composition.
*Blocks:* any new card layout.

All three to be indexed in `open-questions.md`.
