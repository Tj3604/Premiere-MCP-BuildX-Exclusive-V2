---
status: current
verified: 2026-07-30
source-of-truth: mixed
---

# B-Roll

Defines what covers the dialogue — when to cut away, what to cut to, when to build a graphic
instead, and when to stay exactly where you are.

**Source-of-truth: mixed.**

- **Authoritative** — the b-roll-versus-graphic rule, the footage preference order, the
  educational/emotional split, and the repetition rules. Generalised into doctrine here for
  the first time.
- **Mirror** — library location and format notes. Marked inline.
- **Pointer** — every per-clip coverage cue stays in the project clip plans. Nothing
  specific is reproduced.

**Boundary with `editorial.md`:** that file governs how the *dialogue* is cut — shot length,
cut timing, J- and L-cuts. **This file governs what is laid over it.**

---

## The first question is whether to cut away at all

Before choosing a shot, decide whether a cutaway helps.

> **When the value is in how something is said, b-roll is a downgrade.**

Coverage should always strengthen the dialogue, never compete with it.

Some beats are stronger held on the speaker with no coverage at all. A recurring instruction
in the shipped clip plans is simply *"stay on the speaker — the delivery is the content."*
That applies whenever:

- The line is combative, funny, or personally revealing.
- The speaker's expression is doing work the words alone do not.
- The beat is emotional and cutting away would break the moment.

**And when the needed shot does not exist: stay on the conversation.** Never substitute a
shot that shows something else. A wrong cutaway is worse than no cutaway — it quietly
miscommunicates, and on a build the viewer may be evaluating, showing the wrong thing is a
factual error.

---

## B-roll or graphic?

The decision rule, drawn from what has actually been built:

| Use **b-roll** when | Use a **graphic** when |
|---|---|
| The thing exists and can be shown | The thing is abstract, numeric or invisible |
| A porch, a roofline, a shower, a material, a site | A payment schedule, a comparison, a tax calculation |
| Progress or process is visible | Something is underground, inside a wall, or hypothetical |
| The location itself is the point | A statistic, a rule, a limit or a timeline |

### Where no real footage exists

**Build a purpose-built graphic rather than reaching for a substitute shot.** This is already
established practice — several b-roll compositions exist specifically to cover beats no
camera captured: an exterior, a tax calculation, a utility run, a water meter, a location
reference. Each one exists because the alternative was showing something inaccurate.

### Combining the two

Text over footage is allowed and often correct — but **never on a solid card**, which hides
the build the viewer came to see. Bake a semi-transparent full-frame wash into the graphic
and let the footage read through. Specification in `design-system.md`.

---

## Footage preference order

When a beat does want coverage, work down this list. Always work from the most authentic
available source before considering substitutes.

1. **Owned footage of the actual build being discussed.** Always first. It is literally the
   thing being described.
2. **Owned footage of another BuildX build.** Correct when the point is general rather than
   specific to this house.
3. **The reusable b-roll library.** Shot for exactly this purpose.
4. **A purpose-built graphic.** When nothing owned shows the thing.
5. **Stock footage — last resort, and generally avoided entirely.** See below.

---

## Footage types

### Construction footage

Process and progress: foundation, framing, mechanicals, siding, interior fit-out, final
clean. Highest value when a specific stage is named on camera — the viewer hears "septic"
and sees septic.

**The list pattern:** when the speaker enumerates items, **cut one shot per item as it is
named** rather than holding a single wide across the whole list. Siding, then window, then
roofline, then trim. This is the single most repeatable coverage pattern in BuildX content
and it works because the speaker naturally paces the list.

### Drone footage

Site context, lot position, and the spatial relationship between primary house and ADU —
the things a ground shot cannot explain. Strongest under any beat about placement, setbacks,
lot size or "where does it go."

> ⚠️ **Naming trap.** `DJI_`-prefixed clips in the home-tour projects are **not drone
> footage.** They are a gimbal camera on the presenter with a lapel mic. Assuming otherwise
> once led to a wrong conclusion that a project had no usable dialogue. Genuine aerial
> material lives in the drone folder of the b-roll library — check the content, not the
> filename.

### Renders

For anything not yet built, and for configurations the tour house does not have.

**A render must be visually distinguishable from finished-build footage.** A render shown
without that distinction reads as a delivered project, which is a claim about work that does
not exist. Where ambiguity is possible, label it.

### Floor plans

**Vector rebuilds that reveal room by room as they are described** — not a static plan
image. The proven pattern: rooms appear in sequence, timed to the spoken description, so the
viewer is looking at each space as it is named.

A floor plan is a graphic, not footage, and follows the reveal-timing rule: **no room
appears before it is mentioned.** See `production-workflow.md`.

### Software demonstrations

LiDAR, grade analysis, site-planning software. This is a **credibility asset** — it shows
capability that cannot be conveyed by describing it, and it is one of the few places where a
screen recording outperforms any physical shot.

Use it under beats about site analysis, grade, feasibility and "how do you know that."

### Zoom call footage

The free-consultation motif — used for process beats and anywhere the next step is a
conversation rather than a visit.

**Treat any real client footage as requiring permission.** Prefer a staged session or a
graphic representation over recorded footage of an identifiable customer. See
`people.md` for the wider rule on identifying people.

---

## Educational vs emotional coverage

The most important distinction in this file. **Coverage rhythm follows content type, not a
target cut rate.**

| | **Educational beat** | **Emotional beat** |
|---|---|---|
| What it carries | Information | A person |
| Cutting rhythm | **Cut frequently** | **Cut rarely, or not at all** |
| Pattern | One shot per named item; visuals do the enumerating | Establish once, then stay on the speaker |
| Ending | Move on promptly | **Let it breathe** — hold before the end card |

These are editorial defaults rather than rigid rules. The dialogue should always determine
the final pacing.

The shipped example is explicit: an accessibility story cuts to the shower and the doorway
in its first two beats — the concrete things being described — then **stays on the speaker
for the remaining three beats and holds roughly a second and a half of silence before the
end card.**

> **Cutting fast out of an emotional beat destroys it.** If a payoff line needs to land, the
> edit's job is to get out of the way.

Pacing doctrine for the dialogue itself is in `editorial.md`; this is the coverage half of
the same rule.

---

## Avoiding repetitive shots

A batch cut from a single location will reuse the same exterior wide in every short unless
this is managed deliberately.

- **Track which shots have been used across the batch.** Repetition is invisible while
  editing one short at a time and obvious when the batch publishes in sequence.
- **Vary angle, scale and subject** between adjacent publications.
- **Never open two shorts in a batch on the same shot.** The first three seconds are the most
  repetition-sensitive part of the piece.
- **Prefer a detail over another wide.** Most locations offer far more close material than
  wide, and detail shots cut better against dialogue.
- If the same shot genuinely is the best option twice, **separate the two shorts in the
  publication order.**
- **Review the batch as a whole before publication** to catch repetition that is difficult to
  notice while editing individual shorts.

---

## Authentic footage over stock

**BuildX shows its own work.** Stock is the last resort and should generally be avoided
entirely.

Three reasons, in order of weight:

1. **It contradicts the brand's central claim.** The whole proposition is that this is real
   information about real buildings. Stock footage of somebody else's house undermines that
   more than a missing shot ever would.
2. **It risks showing a building BuildX did not build.** A viewer evaluating a builder
   reasonably assumes the buildings on screen are theirs.
3. **There is rarely a technical reason for it.** The library is already shot at delivery
   resolution and aspect ratio.

**If nothing owned fits, build a graphic.** That is always preferable to borrowing a shot of
something that is not BuildX's.

---

## Format note

*Mirrors the library note in session memory.*

The vertical b-roll library is shot **natively in the delivery aspect ratio and resolution**
for short-form work, so it needs **no reframing** — a meaningful saving, and a reason to
prefer the library over cropping a horizontal source.

Library location, folder structure and paths are in `assets.md`.

---

## Scope of this document

This file defines coverage selection only.

- How the dialogue is cut — shot length, cut timing, J/L cuts — belongs in `editorial.md`.
- Graphic specifications — type, colour, layout, the b-roll wash — belong in
  `design-system.md`.
- Library paths, folder structure and formats belong in `assets.md`.
- Render, import and placement procedure belongs in `production-workflow.md`.
- Rules about identifying people on screen belong in `people.md`.

---

## TODOs

**TODO-BR1 — Is there a b-roll capture standard for future shoots?**
Coverage is currently gathered per project with no standing shot list, and the b-roll pass is
performed by hand after the fact. A standing capture checklist — the shots every BuildX shoot
should come away with — would make future editing more consistent and reduce avoidable
coverage gaps.
*Blocks:* nothing today. Highest-leverage improvement available in this file.

**TODO-BR2 — What is the permission policy for identifiable customers?**
Customers and visitors appear incidentally in tour footage, and the Zoom-consultation motif
implies recorded client conversations. `people.md` establishes that customers are never
*named*, but whether recognisable footage of them may be published — and whether a release is
collected — is not documented anywhere.
*Blocks:* nothing today. Worth settling before it matters.

Both indexed in `open-questions.md`.

---

## Sources

| Content | Origin |
|---|---|
| Per-beat coverage cues across a full batch — the richest source of pattern here | `SHORTS-PLAN.md` — B-roll lines on every clip |
| "Stay on the speaker — the delivery is the content" | `SHORTS-PLAN.md` — trim and coverage notes |
| "Stay on the conversation if the shot does not exist" | `SHORTS-PLAN.md` — coverage note where no footage existed |
| One-cut-per-named-item list pattern | `SHORTS-PLAN.md` — material and checklist beats |
| Hold before the end card on an emotional beat | `SHORTS-PLAN.md` — accessibility clip trim note |
| Which beats are educational vs emotional | `SHORTS-CANDIDATES.md` — tier and topic classification |
| `DJI_` prefix is not drone footage | `SHORTS-HANDOFF.md` — source footage notes |
| B-roll pass performed by hand, per project | `SHORTS-HANDOFF.md` — outstanding items |
| Library location, native vertical format, no reframing needed | Session memory — `buildx-graphics-conventions` |
| No solid card over b-roll; bake a wash | Session memory — `buildx-graphics-conventions`; see `design-system.md` |
| Purpose-built b-roll compositions as precedent | `graphics/` and `renders/` — existing `broll-*` compositions |
| Floor-plan reveal pattern | `SHORTS-HANDOFF.md` — graphics state |

Every per-clip coverage cue remains in the project clip plans, unmodified. This file records
only the patterns that recur across them.
