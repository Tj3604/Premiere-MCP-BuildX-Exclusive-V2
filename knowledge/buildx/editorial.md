---
status: current
verified: 2026-07-30
source-of-truth: mixed
---

# Editorial

Defines how BuildX decides **what survives a cut** — selection, hooks, cutting judgement,
pacing, and publication order. This is the doctrine that turns a transcript into a set of
publishable pieces.

**Source-of-truth: mixed.**

- **Authoritative** — the selection method, cutting judgement, length and pacing doctrine.
  Generalised from what shipped; recorded as doctrine for the first time here.
- **Mirror** — intercut restrictions and retention rules summarised from the two existing
  specs in `knowledge/`. Marked inline.
- **Pointer** — every specific candidate, quote and clip plan stays in the project
  documents. Nothing from those is reproduced.

---

## The absolute rule

> **Use exact spoken dialogue only. Never invent, reword or paraphrase a line.**

This principle overrides every other editorial decision in this document.

Everything else in this file is subordinate to it. A short is assembled from things that
were actually said, in the way they were actually said.

This is not a stylistic preference — it is the foundation of the brand's central claim to
be telling the truth. See `brand.md`.

### What this permits

- Removing filler, false starts and repeated clauses **when meaning is unchanged**.
- Keeping natural delivery — stutters, repeated words, self-corrections — where it reads as
  human rather than as an error.
- Cutting a phrase entirely when it cannot be verified.

### What this forbids

- Writing a line that was not spoken, including a connective phrase to bridge two clips.
- Tidying a spoken sentence into better prose.
- Cutting a hedge to make a claim sound stronger. Where the speaker qualifies something —
  *"I haven't proven this yet"*, *"made up number"* — **the qualifier stays.** See
  `verified-facts.md`.
- Captioning a garbled phrase with a guess. See `captions.md`.

---

## What may and may not be rearranged

A short is often stronger when it opens on a later line. This is allowed, within one precise
boundary.

| Operation | Allowed? |
|---|---|
| Open on a line spoken later, then return to the setup | **Yes** — this is a *constructed* short |
| Splice two separated passages into one continuous piece | **Yes**, if both are the speaker's own words and the meaning of neither changes |
| Reorder words or clauses **inside** a single spoken segment | **No** |
| Reverse cause and effect | **No** |
| Move a reaction away from the moment it actually responded to | **No** |
| Fabricate connective dialogue between two segments | **No** |

*Mirrors the intercut restrictions in `knowledge/SHORTS_ENGINE_SPEC.md` and the constructed-
short safeguards in `knowledge/PRODUCTION_ARCHITECTURE.md`. Those files are unmodified and
remain the original statement of these rules.*

### Making a splice invisible

Where two passages are joined, the join should not read as an edit:

- Prefer passages with the **same framing and setup** — a splice between two identical
  framings is invisible.
- A **two-frame dissolve** covers the join where a hard cut would flag it.
- If the framings differ noticeably, cover the join with b-roll rather than pretending the
  cut is continuous. See `broll.md`.

---

## Candidate types

Two taxonomies, both useful. The first describes a candidate's **shape**; the second
describes its **subject**.

### By shape

| Type | Definition |
|---|---|
| **Native** | One continuous, self-contained section. Strongest and cheapest — nothing to construct. |
| **Constructed** | An exact-quote hook combined with a later setup, proof or payoff. |
| **Question-led** | A concise question followed by the strongest complete answer. |
| **Myth / reframe** | A misconception stated, then corrected. |
| **Story** | Conflict, emotional turn, resolution. |
| **Authority** | A specific process, cost, legal, design or construction insight. |

*Mirrors `knowledge/SHORTS_ENGINE_SPEC.md`. That file describes a broader engine that has
never been run; the taxonomy itself is sound and is reproduced here because it is genuinely
useful for classifying a candidate pool.*

### By subject

The topic categories that emerged in practice, and which a balanced batch should span:

Regulation · Cost · Strategy · Misconception · Process · Design · Expertise ·
Customer story · Multigenerational · Social proof · Humour

A batch heavy in one column reads as repetitive even when every individual clip is strong.

---

## Selection

1. **Mine widely before judging.** Capture candidates as **verbatim quotes with timecodes**.
   Never paraphrase into a candidate list — a reworded candidate becomes an invented line
   three steps later.
2. **Tier by strength**, and record *why* each earns its tier. A tier without a reason is
   unreviewable. Reasons should be specific enough that another editor could independently
   reach the same conclusion.
3. **Dedupe hard by topic.** The same argument will surface three or four times across a
   shoot. **Keep the single best telling and drop the rest** — a batch with duplicate topics
   reads as thin, no matter how good each version is.
4. **Balance authority against humanity.** The strongest tier is usually top-heavy with
   authority and expertise. Deliberately pull warmth in — customer stories, origin, humour —
   or the batch reads as a lecture.
5. **Verify each pick on frame.** A verbally perfect moment can be visually unusable: the
   speaker in profile, back to lens, or blocked by someone walking through. Check before
   committing.
6. **Present the list before building.** Hook, script map, trim notes, coverage cues, title
   options. Building an unapproved list wastes the expensive half of the work.

### Judging a candidate

A strong candidate usually has:

- A **specific, surprising or contradicted** claim rather than a general one.
- A **hard number, rule or limit** in it — these are what search rewards and what viewers
  save.
- A **self-contained arc** — it makes sense to someone who has seen nothing else.
- **Delivery worth watching**, not just information worth reading.
- **A clear takeaway that a viewer can immediately apply or remember.**

---

## Hook standards

**The first three seconds must earn the next thirty.**

A hook must deliver at least one of:

| Device | What it does |
|---|---|
| **Contradiction** | Names a widely held belief and rejects it |
| **High-stakes consequence** | Something expensive or irreversible is at risk |
| **Specific promise** | States exactly what the viewer will know by the end |
| **Surprising fact** | A number or rule the audience did not expect |
| **Emotional tension** | A human situation with something unresolved |
| **Clear audience problem** | Names the viewer's actual situation back to them |

Rules:

- **Front-load the strongest line.** If the best sentence is at 0:40, the short probably
  starts at 0:40.
- **Never over-claim to make a hook land.** A provocative hook is fine; a misleading one
  costs more than it earns, and contradicts the brand. Provocative *and* defensible is the
  bar.
- The hook is a **selection decision**, not a copywriting exercise — it is chosen from what
  was said, not written.

*Hook graphic specifications — type, layout, render format — are in `design-system.md`.*

---

## Cutting judgement

The transcript is a script, not a waveform. Cut for meaning.

**Cut:**

- Filler openings — *"okay so"*, *"basically"*, *"um"*.
- False starts and restarts.
- Slate and setup chatter before the take begins.
- Repeated takes — **keep the tighter delivery of the two.**
- The re-explanation. Keep the **first clean statement** of an idea; drop the second pass.
- Asides that break the frame mid-lesson. If one is genuinely funny, spin it out as its own
  short rather than leaving it to derail a teaching beat.
- Unrelated interruptions inside an argument.

**Keep:**

- Natural stutters and repeated words where the delivery reads as human.
- Hedges and qualifiers — always.
- A beat of silence after a line that needs to land.

**Padding around a cut:** leave a small breath either side so words are not clipped. Widen
it when a cut lands tight against a consonant.

**"Cut it hard"** means keep only load-bearing sentences — expect to lose **50–70%** of the
source.

*Mirrors the cutting-judgement guidance in `CLAUDE.md`, which remains the original.*

---

## Length

**Length should be determined by editorial quality rather than a predetermined duration.**

- Publish the length the material actually supports. A tight 30 seconds beats a padded 60.
- **Never pad to reach a duration.** If a clip runs 34 seconds of usable material, publish 34
  — do not stretch it with weaker surrounding lines to hit a round number.
- If a clip is short because that is all that exists, that is a complete answer, not a
  deficiency. Some of the strongest material is 12–20 seconds.
- Where a second passage genuinely strengthens a short piece, splice it under the rules
  above. Where it merely lengthens it, leave it out.

---

## Pacing

- **Let a payoff line breathe.** After the strongest sentence, hold — roughly a second and a
  half of silence before the end card on an emotional beat. Cutting fast out of a payoff
  destroys it.
- **Educational beats can move quickly.** Where the speaker is enumerating, keep it tight.
- **Match cutting rhythm to content type**, not to a target edit rate. See `broll.md` for
  how coverage follows the same split.

---

## Shot and coverage doctrine

How the dialogue itself is cut. *What covers it* is in `broll.md`.

| Rule | Detail |
|---|---|
| **Minimum shot length** | Avoid shots under roughly **2.4 seconds**, except when correcting an interruption |
| **Maximum static hold** | Break a static shot around **8–13 seconds** — based on sentence structure, not a timer |
| **Cut on meaning** | Thought changes, points of emphasis, question/answer transitions, emotional reactions |
| **Never alternate mechanically** | Switching angle after every sentence reads as a machine edit |
| **J- and L-cuts** | Preserve them where they improve flow |
| **Punch-ins** | A secondary layer only. **Do not use a punch-in to fake a second camera angle.** |

*Mirrors the retention rules in `knowledge/MULTICAM_SPEC.md`. **Note:** that spec's
angle-switching engine assumes speaker-labelled transcripts and a camera map — neither of
which exists today. The rules above are the portion that is usable now.*

---

## Publication order

Ordering a batch is its own editorial decision.

| Position | What goes there | Why |
|---|---|---|
| **First** | The biggest hook with the broadest appeal | Sets the tone and reaches widest |
| **Early** | An emotional counterweight | Stops an authority-heavy opening reading as cold |
| **Early–middle** | Highest search-intent pieces — cost, timeline | Where deliberate viewers arrive |
| **Middle** | Quick FAQs, social proof, controversy | Keeps cadence varied |
| **Later** | Technical and niche answers | Narrower appeal, high value to the right viewer |
| **Last** | The warm closer | Leaves the feed on a human note |

Two standing rules:

- **Never publish two shorts on the same topic back to back**, even if both survived
  deduping.
- **Do not open two consecutive shorts the same way** — same framing, same shot, same
  sentence structure.

> ⚠️ **Publication order is not build order.** A batch is planned in one sequence and
> published in another. Once exported, a short's identity is its manifest number and slug —
> never its position in the plan. See `production-workflow.md`.

---

## Platform priority

Not every short is equally suited to every platform. The pattern observed across a shipped
batch:

| Content type | Leans toward |
|---|---|
| Provocative, myth-busting, price-led | Short-form video platforms broadly |
| Emotional and story-led | Feeds that reward watch-through |
| Strategy, professional and regulatory insight | Professional networks |
| Search-intent answers — cost, duration, process | Search-indexed video |

This reflects **current editorial preference rather than a permanent publishing rule**, and
it is generalised from a single batch — see TODO-E1.
Every short in a batch still ships everywhere unless there is a reason not to.

---

## Source manifest

**Every edit beat must be traceable to its source.** For each beat in a built short, keep:

- The **source clip** it came from
- The **source timecode** range
- The **verbatim quote**

This is what makes a claim checkable months later, and it is the only practical way to
answer "did he actually say that?" without re-watching an hour of footage. It also feeds
the per-short transcripts delivered at handoff.

*Mirrors the logging safeguard in `knowledge/PRODUCTION_ARCHITECTURE.md`.*

---

## Scope of this document

This file defines selection and cutting doctrine only.

- **What covers the dialogue** — b-roll, graphics, coverage choices — belongs in `broll.md`.
  The boundary: `editorial.md` governs how the *dialogue* is cut; `broll.md` governs what is
  laid over it.
- Voice, messaging and the CTA rule belong in `brand.md`.
- Caption policy belongs in `captions.md`.
- Numbers, statistics and required qualifiers belong in `verified-facts.md`.
- Process, ordering of operations and QA belong in `production-workflow.md`.
- Speaker identity belongs in `people.md`.

---

## TODOs

**TODO-E1 — Is the platform-priority lean a standing rule?**
The mapping above is generalised from one shipped batch's per-clip judgements, not from
performance data. Confirm whether it reflects BuildX's actual platform strategy, or replace
it with what the analytics show. Until then it is a starting assumption, not doctrine.
*Blocks:* nothing. Prevents a single batch's judgement calls hardening into a rule.

**TODO-E2 — Is there a standing batch size?**
Batches have been briefed in the 15–20 range, but whether that is a standing target or was
specific to one job is not documented. Related: is there a minimum bar below which a
candidate should simply not be published, even if it is the best remaining?
*Blocks:* nothing. Affects how aggressively to dedupe.

Both indexed in `open-questions.md`.

---

## Sources

| Content | Origin |
|---|---|
| Dedupe-hard, balance authority against warmth, lead with the broadest hooks | `SHORTS-CANDIDATES.md` — selection guidance |
| Publication-order pattern and platform lean | `SHORTS-PLAN.md` — publication order and platform priority |
| Length-is-an-outcome; pacing; splice technique; keep-the-hedge; asides | `SHORTS-PLAN.md` — per-clip trim notes |
| Topic categories | `SHORTS-CANDIDATES.md` — tier tables |
| Cutting judgement, filler removal, "cut it hard" | `CLAUDE.md` — cutting judgement |
| Candidate shape taxonomy; hook devices; intercut restrictions | `knowledge/SHORTS_ENGINE_SPEC.md` |
| Shot length, static-hold, cut-on-meaning, J/L cuts, punch-ins | `knowledge/MULTICAM_SPEC.md` |
| Constructed-short word-order safeguard; source logging | `knowledge/PRODUCTION_ARCHITECTURE.md` |
| Verify picks on frame before committing | `SHORTS-HANDOFF.md`; `SHORTS-CANDIDATES.md` |
| Exact-dialogue rule | `SHORTS-HANDOFF.md` — brief; `knowledge/SHORTS_ENGINE_SPEC.md` |

The three files under `knowledge/` are **unmodified and remain in place.** Two of them
describe capability that has never been built — the shorts engine and the multicam
angle-switching layer. Where this file borrows from them, it borrows only the portion proven
in practice, and says so.
