---
status: current
verified: 2026-07-30
source-of-truth: authoritative
---

# Open Questions

The single register of everything unresolved across this knowledge base — what it is, which
file it affects, and what answering it unblocks.

**Source-of-truth: authoritative** for the register itself. **Pointer** for the detail: each
question's full context lives in the file that raised it. This file is the index, not a
second copy.

---

## Why this file exists

Building this knowledge base surfaced **26 decisions that could not be made from the
repository alone.** Every one of them was written as an explicit `TODO` in the file it
affects rather than resolved by assumption.

That was deliberate. **No file in this knowledge base guesses a value in order to look
finished.** A knowledge base that quietly invents an answer is worse than one that admits a
gap — the invention becomes canon the moment someone reads it.

This register exists so those gaps are visible in one place, and so the ones that share a
root cause can be answered together rather than one at a time.

It should shrink over time. A growing register is a signal that decisions are not being
closed.

---

## Answer these first

Three questions gate real work. Until they are settled, every new graphic either copies an
existing composition or picks a value that may be wrong.

| # | Question | Detail in |
|---|---|---|
| **DS1** | **Which gold is canonical** — three values are in documented use, two of them for the same surface | `design-system.md` |
| **DS2** | **Which typeface pair** — the hook-template override reads as blanket, but every composition uses the older pair | `design-system.md` |
| **DS3** | **Is grain texture permitted** — one source bans it with a reproducible failure, another requires it | `design-system.md` |

All three come from the same root: **two generations of brand documentation that were never
reconciled with each other.** They are one conversation, not three.

**SZ2 was a fourth gating question and is now closed** (2026-08-11): the logo sat inside the
title-safe band, where the iPhone Dynamic Island was covering it. Resolved to
`[0.5, 0.1530]` / scale 40. See `safe-zones.md`.

---

## The full register

| # | Question | File | Blocks | Priority |
|---|---|---|---|---|
| **SZ3** | Raise the side margin from 51px to the 108px edge safe? | `safe-zones.md` | Any new card layout | **High** |
| **SZ4** | Does the end-card asset's own logo clear the safe zone? | `safe-zones.md` | Nothing today; affects all 14 shorts if so | **High** |
| **SZ1** | Are portrait safe zones full-width or inset 108px? | `safe-zones.md` | Final side-margin value | **High** |
| **DS1** | Which gold is canonical? | `design-system.md` | Every new graphic | **Gating** |
| **DS2** | Which typeface pair? | `design-system.md` | Every new graphic | **Gating** |
| **DS3** | Is grain texture permitted? | `design-system.md` | Hook graphics | **Gating** |
| **W1** | Document the podcast editing workflow | `production-workflow.md` | Podcast work from documentation | **High** |
| **T1** | Resolve six unresolved transcript lines | `terminology.md` | Captioning any clip containing them | **High** |
| **T2** | Is there a canonical list of towns BuildX serves? | `terminology.md` | — | **High** |
| **VF4** | Is there a canonical service-area list? | `verified-facts.md` | — | **High** |
| **BR1** | Is there a b-roll capture standard for future shoots? | `broll.md` | — | **High** |
| **A1** | Do brand-permanent assets have a durable home? | `assets.md` | — | **High** |
| **G2** | The generated tool audit cannot detect runtime failure | `premiere-gotchas.md` | — | **High** |
| **P1** | Confirm the identity of the off-screen interviewer | `people.md` | Precise speaker labels | Medium |
| **DS4** | Thumbnail specifications | `design-system.md` | Thumbnail work | Medium |
| **VF1** | Is the price range current? Per-model pricing? | `verified-facts.md` | Pricing graphics for other models | Medium |
| **VF2** | Refresh cadence for project counts | `verified-facts.md` | — | Medium |
| **VF3** | Has the 1,300 sq ft bylaw's regulatory status changed? | `verified-facts.md` | Any piece referencing the raised cap | Medium |
| **A2** | Does the end card contain information that goes stale? | `assets.md` | — | Medium |
| **A3** | Should each composition carry a description? | `assets.md` | — | Medium |
| **BR2** | Permission policy for identifiable customers | `broll.md` | — | Medium |
| ~~**C1**~~ | ~~Is there a standing caption safe area?~~ **Closed 2026-08-11** — see `safe-zones.md` | `captions.md` | — | ✅ Resolved |
| **C2** | Document caption readability standards | `captions.md` | — | Medium |
| **W2** | Confirm the per-format frame-rate rule | `production-workflow.md` | — | Low |
| **E1** | Is the platform-priority lean a standing rule? | `editorial.md` | — | Low |
| **E2** | Is there a standing batch size and a quality floor? | `editorial.md` | — | Low |
| **G1** | Resolve the `ripple_delete` contradiction | `premiere-gotchas.md` | — | Low |
| **A4** | Document the canonical meaning of every project prefix | `assets.md` | — | Low |
| **B1** | Is there a standing editorial approval role? | `brand.md` | — | Low |

**"Blocks" means work that cannot proceed correctly without an answer.** A blank means the
question improves quality or reduces recurring cost, but nothing is stuck.

---

## Questions that share a root

Several of these are cheaper to answer together. This is the part no individual file can
see.

### 1 · The visual conflicts — DS1, DS2, DS3

One root cause: two generations of brand documentation, never reconciled. **One conversation
answers all three** and unblocks every graphic.

### 2 · The town list — T2, VF4, and most of T1

A canonical list of towns BuildX works in would:

- settle the **service-area** claim (VF4),
- turn garbled **place names** from a listen-back into a lookup (T2),
- and resolve **two of the six** unresolved transcript lines directly (T1).

**One list, three questions closed.** The highest ratio of value to effort in this register.

### 3 · End-card durability — A1, A2

Where the card lives, and whether its content goes stale, are the same conversation: **can
this asset be relied on across projects without being re-checked each time?**

### 4 · Caption presentation — C1, C2

Safe area and readability are one specification, and they interact — line length depends on
available area.

### 5 · Tool trust — G1, G2

A live smoke test answering **G2** would resolve **G1** as a side effect, since it would test
`ripple_delete` along with everything else.

### 6 · Fact freshness — VF1, VF2, VF3

All three are a single review of `verified-facts.md` against current reality, plus a decision
about how often that review recurs.

---

## Deferred to Phase 2

Not questions — **known issues with an agreed answer, deliberately out of scope** for an
additive phase. Recorded so they are not lost.

| Issue | Why it was deferred |
|---|---|
| **Nothing reads this knowledge base automatically** | Wiring an entry point means editing `CLAUDE.md`, which Phase 1 does not touch. Until then, reference `knowledge/buildx/README.md` explicitly when starting BuildX work. |
| **Two handoff documents, no stated precedence** | Two projects on two volumes, neither marked current. Resolving it means editing existing documents. **Operational mitigation is already in place:** confirm the frontmost project with `get_project_info` before every build step — see `premiere-gotchas.md`. |
| **A project document's status header is out of date** | It states nothing has been built; work shipped afterwards. Correcting it means editing an existing document. |
| **`CLAUDE.md` recommends a tool the audit lists as a no-op** | Same file-edit constraint. Tracked as **G1** for the underlying fact. |
| **Session-memory files still hold a second copy of the brand system** | The nine memory files outside this repository remain authoritative-looking. Phase 3 rewrites them as pointers to these files. |
| **Three aspirational specs in `knowledge/` describe unbuilt capability** | Two of them assume inputs that do not exist. They are unmodified and cited honestly wherever this knowledge base borrows from them. Whether they still reflect intent is a Phase 2 decision. |

---

## How to answer a question

1. **Answer it in the owning file**, replacing the `TODO` block with the resolved content.
2. **Remove the row from this register.** A closed question does not stay here — closed
   questions belong in version history. This register should describe the current state
   only, not act as historical record.
3. **Date the change.** Update the file's `verified:` line.
4. **If the answer is "no such thing exists,"** that is a valid resolution. Several questions
   are written so a negative answer removes them cleanly.

**A question only leaves this register when it has been answered, never when it has been
worked around.** If a workaround is adopted, record the workaround and keep the question
open.

---

## Adding a question

Any file may raise one. The convention:

- Write it as a `TODO` block in the file it affects, with a stable ID prefixed by that file
  (`DS`, `VF`, `BR`, …).
- State **what it blocks** — and if it blocks nothing, say so plainly rather than inflating
  it.
- Add a row here.

**Raise a question rather than making an assumption.** That is the rule this entire knowledge
base was built under, and this register is the evidence that it was followed. A concise,
well-defined question is preferable to a broad or speculative TODO.

---

## Scope of this document

This file indexes unresolved decisions only.

- The full context for each question lives in the file that raised it.
- Resolved decisions belong in the owning file, not here.
- Project-specific open items — a clip needing a re-listen, a cosmetic timeline gap — stay in
  the project handoff documents. **This register covers only decisions affecting permanent
  BuildX knowledge.**

---

## Sources

Every question in this register was raised while writing the file named in its row, and was
derived from a conflict, gap or unverifiable claim found in:

| Origin | What it surfaced |
|---|---|
| Session-memory brand files | The three visual conflicts (DS1–DS3) |
| `SHORTS-PLAN.md` — per-clip trim notes and open flags | Unresolved transcript lines, mandatory qualifiers, naming restrictions |
| `SHORTS-HANDOFF.md` — tool gotchas and build history | Tool-behaviour contradictions, asset identifiers, workflow gaps |
| `SHORTS-CANDIDATES.md` | Selection doctrine questions |
| `TOOL-RELIABILITY.md` read against live observation | The audit's blind spot (G2) and the `ripple_delete` conflict (G1) |
| `graphics/`, `renders/`, `.gitignore` — direct inspection | Asset durability, versioning, catalogue gaps |
| Absence of any record | The podcast workflow (W1), capture standards (BR1), caption specs (C1–C2) |

All source documents remain unmodified.
