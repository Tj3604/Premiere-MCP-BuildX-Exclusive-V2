---
status: current
verified: 2026-07-30
source-of-truth: authoritative
---

# People

Defines recurring on-camera identities and speaker-labelling rules. Small file, high
consequence.

**Source-of-truth: authoritative.** No document in this repository currently states any of
this. It was reconstructed from session memory and from the speaker labels used throughout
`SHORTS-PLAN.md`.

---

## Why this file exists

Getting speaker identity wrong has already produced shipped and near-shipped errors:

- A lower third was captioned with the name of someone who is not the on-camera subject,
  over footage of **Buz**.
- Subagents were briefed to look for the wrong speaker answering customer questions, and
  searched 14 transcripts for a voice that was never in them.
- A clip-strategy deliverable labelled the podcast host with the wrong name.

Each was corrected. All three came from the same root cause: **assuming the person who
supplies the footage is the person in it.**

---

## The cast

| Name | Role | On camera? | Valid speaker label? |
|---|---|---|---|
| **Buz** | BuildX representative — the voice and face of the tour and podcast content | **Yes** — the primary on-camera subject | **Yes** — `BUZ` |
| Off-screen interviewer (unconfirmed) | May appear asking questions from behind the camera | Off camera | `INTERVIEWER (o/s)` |
| Customers / Visitors | Open-house attendees asking questions | Sometimes, incidentally | Yes — generic only, see below |
| Podcast guests | Interview subjects on *Just Build Baby* | Yes | Yes — by real name |

### Buz

The BuildX representative on camera in the ADU home-tour footage, answering customer
questions, and the host of the *Just Build Baby* podcast.

For the ADU Home Tour footage documented in this repository, **Buz is the primary BuildX
on-camera representative.** Unless a speaker is clearly identified otherwise, the primary
BuildX speaker in the documented Home Tour footage is Buz. **Future BuildX projects should
identify the primary speaker rather than assuming it is Buz.**

The recurring signoff — *"Remember, just build baby"* — is Buz's, and appears in the
piece-to-camera clips. See `brand.md`.

### Off-screen interviewer

`SHORTS-PLAN.md` labels one off-screen question as `TOM (o/s)`. That attribution has not
been independently confirmed. Until the interviewer has been positively identified, use the
generic label `INTERVIEWER (o/s)` rather than a person's name.

### Customers and visitors

Open-house attendees. They ask real questions and occasionally appear in frame. They are
members of the public who did not sign up to be identified.

**Never name a customer or visitor on screen.** Use a generic label. The labels already in
use across the clip plans are `CUSTOMER` and `VISITOR`.

### Podcast guests

*Just Build Baby* guests are named. Use the guest's real name as the speaker label — e.g.
`JON WELLS` — alongside `BUZ` for the host.

---

## Speaker labelling rules

For transcripts, script maps, caption files and any internal document:

| Speaker | Label |
|---|---|
| Buz | `BUZ` |
| A customer or open-house visitor | `CUSTOMER` or `VISITOR` |
| Unconfirmed off-screen interviewer | `INTERVIEWER (o/s)` |
| A named podcast guest | Their real name, e.g. `JON WELLS` |

**Whisper does not diarise.** Transcripts arrive with no speaker attribution at all, and
some passages collapse several speakers into one 100-second line. Every speaker label in
this project's documents was assigned by a human or a model reading context — none of it
came from the transcription. Treat any label in a transcript-derived document as a
judgement that can be wrong, and re-check it before it reaches the screen.

*(The no-diarisation behaviour is recorded in `SHORTS-HANDOFF.md`; see also
`production-workflow.md`.)*

---

## Speaker identification priority

When identifying a speaker, use this order of confidence:

1. Existing verified project documentation
2. Direct visual confirmation
3. Production notes
4. Transcript context
5. Never guess

If identity cannot be confirmed, use a generic label rather than a person's name.

---

## Scope of this document

This file defines people and speaker identity only.

- Editorial decisions belong in `editorial.md`.
- Production responsibilities belong in `production-workflow.md`.
- Brand voice belongs in `brand.md`.
- Visual presentation belongs in `design-system.md`.

Keeping these responsibilities separate prevents duplication and makes each document the
authoritative reference for its own topic.

---

## Putting a name on screen

**The rule: never put a person's name on screen if the name was inferred rather than
confirmed. Ask first.**

This covers lower thirds, captions, titles, descriptions and thumbnails. A transcript is not
a source of identity — Whisper produces plausible-looking proper nouns that are simply
wrong, and it cannot tell you who is speaking in the first place.

The same restraint applies to place names: **never name a town Buz did not name.** See
`terminology.md` and `verified-facts.md`.

---

## Vocabulary trap: "Buz proofed"

When a request asks for something to be **"Buz proofed"**, it means:

> **Make it simple enough to be understood at a glance by the least technical reader.**

Concretely, for a report or summary: label every before/after comparison with real calendar
dates rather than vague words like "then/now"; lead with big obvious headline numbers before
any detail table; cut or shrink technical caveats to a single footnote; keep detail tables
but mark them "for reference only."

**It is not a request to involve Buz.** The name is being used as a stand-in for
"foolproof" / "the most non-technical reader." Reading it literally and looping in a person
is the failure mode this note prevents.

---

## TODOs

**TODO-P1 — Confirm the identity of the off-screen interviewer.**
`SHORTS-PLAN.md` carries an off-screen attribution that has not been independently
confirmed. Until it is, off-screen voices take the generic `INTERVIEWER (o/s)` label.
Confirming the identity would allow accurate attribution instead.
*Blocks:* precise speaker labels in captions and script maps.

Indexed in `open-questions.md`.

---

## Sources

| Content | Origin |
|---|---|
| Historical speaker-identification corrections | Session memory |
| Podcast host and guest labelling | Session memory |
| `CUSTOMER`, `VISITOR` and off-screen labels in use | `SHORTS-PLAN.md` — clip script maps |
| "Buz proofed" meaning and its trap | Session memory |
| Whisper does not diarise | `SHORTS-HANDOFF.md` — production notes |
| Speaker identification priority | Editorial guidance, verified 2026-07-30 |

Session-memory files are outside this repository, in
`~/.claude/projects/-Users-thomasmartell-Downloads/memory/`. They are not version-controlled
and do not load in a session opened at this project's own directory — which is why this
content was brought into the repository. See `open-questions.md` (question 5) for their
planned disposition.
