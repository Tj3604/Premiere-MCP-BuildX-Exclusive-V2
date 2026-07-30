---
status: current
verified: 2026-07-30
source-of-truth: mixed
---

# Captions

Defines caption policy — accuracy, style, emphasis and the rules governing what may appear
as burned-in text.

**Source-of-truth: mixed.**

- **Authoritative** — the accuracy policy and its escalation path, and the emphasis rules.
  Consolidated here from guidance previously scattered across per-clip notes.
- **Mirror** — style values inherit from `design-system.md`; the caption generator's own
  output specification is documented with the skill that produces it.
- **Pointer** — known mis-transcriptions live in `terminology.md`; on-screen figures and
  their required qualifiers live in `verified-facts.md`.

---

## Captions are not optional

**Burned-in captions are non-negotiable on conversational audio.**

BuildX content is open-house conversation and unscripted answers — overlapping speech,
background noise, and delivery that moves fast. It is also consumed muted by default on
every platform it publishes to. Captions are the primary channel, not an accessibility
afterthought.

Captions should be treated as part of the editorial product rather than a post-production
accessory.

---

## The accuracy rule

> **Caption what was actually said. If it cannot be established, cut the phrase. Never
> guess, never paraphrase.**

This is the governing rule of this document and everything below is subordinate to it.

Automatic transcription produces confident, plausible, wrong text. It will render an unheard
word as a real word, a technical term as a similar-sounding one, and an unfamiliar place
name as a name that does not exist. Burned into a caption, each of those becomes a statement
BuildX appears to have made on purpose.

### The escalation path

When a line is unclear, work through these in order. **Never skip to the end.**

1. **Listen back to the audio.** Most garbles resolve immediately — the transcript is wrong,
   the speaker is clear.
2. **Check the lexicon** in `terminology.md`. Recurring mis-transcriptions are recorded there
   with their verified corrections.
3. **Escalate the transcription model.** A larger model frequently resolves a phrase a
   smaller one garbled.
4. **Ask.** For a business fact, a product detail or a person, the answer exists — it just
   is not in the audio.
5. **Cut the phrase.** If it still cannot be established, remove it from the clip. If
   removing the phrase changes the meaning of the clip, reconsider whether the clip should be
   published.

**There is no step that permits a guess.** "It probably says…" is not a step.

### After resolving

**Add newly confirmed corrections to the lexicon in `terminology.md`.** The same model, on
the same speaker, on the same subject, garbles the same words on every shoot — a correction
recorded once saves the work every time after. This is the single highest-return habit in
the caption workflow.

---

## What captions must never do

| Never | Why | Reference |
|---|---|---|
| Put a name on screen that was inferred rather than confirmed | Transcription invents plausible proper nouns, and cannot identify speakers at all | `people.md` |
| Name a place that was not named on camera | The same failure, with legal and factual exposure | `people.md`, `terminology.md` |
| State a figure without checking it | Some figures carry mandatory qualifiers | `verified-facts.md` |
| Drop a qualifier the speaker gave | Removing a hedge converts an honest statement into a claim | `verified-facts.md`, `brand.md` |
| Tidy a spoken sentence into better prose | Exact dialogue only | `editorial.md` |

### Qualifiers are part of the quote

Where the speaker hedges — flagging an estimate, an unproven belief, or a rule still pending
— **the qualifier is captioned with the claim.** It is never dropped for brevity or impact.

Some figures in `verified-facts.md` are marked as requiring an explicit on-screen qualifier.
Those are not optional and not stylistic. **Check the register before any number is burned
in.**

---

## Preserve natural delivery

Captions transcribe speech, not prose. **Keep the delivery human:**

- Keep stutters and repeated words where they read as natural.
- Keep self-corrections where the speaker makes them.
- Keep contractions and colloquial phrasing exactly as spoken.

Removing filler is a **cutting** decision governed by `editorial.md`. It is not a caption
decision — a caption never silently differs from the audio under it.

---

## Style

Caption styling is part of the visual system. **All values inherit from
`design-system.md`** — this file does not restate them. This file defines policy rather than
presentation.

The established treatment:

| Element | Treatment |
|---|---|
| Body text | White |
| Outline | Black stroke, for legibility over any footage |
| Emphasis | Gold on key words |
| Placement | Burned in, clear of platform interface chrome |

### Emphasis

Gold highlighting follows the same discipline as every other BuildX graphic:

- **Emphasise the payoff** — the number, the limit, the surprising word. Not the whole
  phrase.
- **One emphasis per beat.** If most of a line is gold, the emphasis has stopped working.
- Emphasis is a **reading aid**, not decoration. It marks what the viewer should take away
  if they read nothing else.

> The gold value itself is an open question — see **TODO-DS1** in `design-system.md`. Until
> it is settled, take the value from the caption output already in use rather than
> introducing a new one.

---

## Timing

- **Word-level transcript data is authoritative for caption timing.** Line boundaries in a
  readable transcript are not — automatic transcription collapses long passages into single
  lines and does not separate speakers.
- Captions track the spoken word. A caption that leads the audio reads as a subtitle for a
  different take.
- Where a payoff line is held for emphasis, **the caption holds with it.** Do not clear text
  early on a line that is deliberately breathing.
- Caption timing should follow the speaker's cadence rather than aiming for perfectly uniform
  display durations.

---

## Files and tooling

| Artefact | Role |
|---|---|
| `.srt` in `captions/` | Interchange format — plain, portable, reviewable |
| Styled subtitle output | Carries the visual treatment |
| Alpha overlay render | Caption layer with a transparent background, composited over footage |

Caption generation is performed by the project's caption skill, which is the executable
procedure and remains the source of truth for its own flags and output. **This file is
policy; the skill is process.**

The `captions/` directory is a working directory. Treat a caption file as a draft until the
accuracy pass has been run against it.

---

## The review pass

Before any caption is burned in:

- [ ] Every quoted line checked against the audio — not just the ones that looked wrong.
- [ ] Every known mis-transcription resolved from `terminology.md`, or the phrase cut.
- [ ] No unresolved garble anywhere in the clip.
- [ ] No inferred name, no unnamed place.
- [ ] Every figure checked against `verified-facts.md`, with any required qualifier present.
- [ ] Hedges and qualifiers intact.
- [ ] Emphasis marks the payoff, once per beat.
- [ ] Timing tracks the audio; held lines hold.
- [ ] New corrections added back to `terminology.md`.

*This mirrors the caption items in the QA checklist in `production-workflow.md`, which is the
single pre-export gate.*

---

## Scope of this document

This file defines caption policy only.

- Caption colour, type and layout values belong in `design-system.md`.
- Known mis-transcriptions and the correction lexicon belong in `terminology.md`.
- Figures, statistics and mandatory qualifiers belong in `verified-facts.md`.
- What to cut from a clip belongs in `editorial.md`.
- Where captions sit in the production sequence belongs in `production-workflow.md`.
- Rules about naming people belong in `people.md`.

---

## TODOs

**TODO-C1 — Is there a standing caption safe area?**
Platform interface chrome — usernames, captions, action rails, progress bars — covers
different regions on each surface, and no safe-area specification is recorded anywhere.
Without one, caption placement is decided per project and risks being obscured on the
platform where a short performs best.
*Blocks:* nothing today. Would prevent a class of avoidable rework.

**TODO-C2 — Are there reading-speed or line-length standards?**
Document readability standards, including maximum line length, reading speed and minimum
display duration. Fast conversational delivery makes this a real constraint, and it
interacts with TODO-C1.
*Blocks:* nothing today.

Both indexed in `open-questions.md`.

---

## Sources

| Content | Origin |
|---|---|
| Captions non-negotiable on conversational audio | `SHORTS-PLAN.md` — global treatment |
| Caption-accurately-or-cut rule; "do not guess", "do not paraphrase" | `SHORTS-PLAN.md` — per-clip trim notes on garbled lines |
| Specific unresolved garbles requiring a listen-back before captioning | `SHORTS-PLAN.md` — open flags; `SHORTS-HANDOFF.md` — outstanding items |
| Qualifier-must-survive rule | `SHORTS-PLAN.md` — trim notes on the estimate and the unproven-claim clips |
| Do not caption an unnamed place | `SHORTS-PLAN.md` — trim notes |
| Keep natural stutters and repeated words | `SHORTS-PLAN.md` — trim notes |
| Word-level data authoritative for timing; line boundaries are not | `SHORTS-HANDOFF.md` — production notes; `CLAUDE.md` |
| Caption visual treatment and alpha overlay output | Project caption skill definition |
| Model escalation resolving a garbled phrase | `SHORTS-HANDOFF.md` — head-extension note |

Per-clip caption decisions remain in the project clip plans, unmodified. This file records
only the policy that applies to every project.
