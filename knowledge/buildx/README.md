---
status: current
verified: 2026-07-30
source-of-truth: authoritative
---

# BuildX Knowledge Base

Permanent BuildX knowledge — brand, voice, visual system, editorial doctrine, terminology,
verified facts, and hard-won Premiere behaviour. Everything here is meant to be true on the
**next** BuildX project, not just the last one.

This directory was created as **Phase 1** of a documentation reorganisation. Phase 1 is
**purely additive**: no existing file in this repository was modified, moved, renamed or
deleted. Everything that worked before still works exactly the same way.

---

## What this is — and what it is not

**This is** the durable BuildX layer: how the company sounds, how its graphics are built,
how footage is chosen and cut, what numbers are safe to put on screen, and which Premiere
tools lie about succeeding.

**This is not** a project tracker. No sequence IDs, no project item IDs, no per-shoot
status, no "what's left to do on the current job." That information lives — and stays — in
the handoff documents at the repository root.

### The inclusion test

Before adding anything to this directory, ask:

> **Would this still be true and useful on the next BuildX shoot, with different footage?**

- **Yes** → it belongs here.
- **No** → it belongs in a handoff document.

This is the guard rail. Without it, a knowledge base slowly turns into a third handoff
document and then rots when the job ends. Anything that is permanent-but-time-varying (a
project count, a price) belongs here **with a `verified:` date**, so a stale figure is
visible rather than silently reused.

---

## Where project state lives

| Document | Covers |
|---|---|
| `HANDOFF.md` | Session handoff — the earlier Hometour project on `/Volumes/BuildX-TM` |
| `SHORTS-HANDOFF.md` | Session handoff — the HomeTour 7.25.26 shorts build, graphics state, delivery |
| `SHORTS-PLAN.md` | The 20-clip plan for that build — scripts, trim notes, titles, publication order |
| `SHORTS-CANDIDATES.md` | The 63-candidate tiered pool mined from those transcripts |
| `faq-shorts-plan.json` | The FAQ Shorts build record |
| `exports/shorts/_manifest.json` | What actually shipped, with durations |

**These remain authoritative for project state.** Nothing in `knowledge/buildx/` replaces
them, and Phase 1 did not edit any of them.

> **Known gap (Phase 2):** there are two handoff documents describing two different projects
> on two different volumes, and neither states which is current. Until that is resolved,
> **always confirm the frontmost project with `get_project_info` before any build step** —
> see `premiere-gotchas.md`. Tracked as open questions 7 and 8.

---

## Where tooling truth lives

| Document | Covers |
|---|---|
| `CLAUDE.md` | The operating manual — bridge startup, workflows, frame math, command syntax |
| `TOOL-RELIABILITY.md` | Generated static audit of which MCP tools are really implemented |
| `presets/README.md` | Audio chain and colour treatment notes |

`CLAUDE.md` is unmodified and remains the operating manual. `premiere-gotchas.md` in this
directory records **live-verified behaviour** that a static audit cannot detect; where the
two disagree, live observation wins. It does not restate `CLAUDE.md`.

---

## Reading order

**Starting BuildX work for the first time:**

1. `people.md` — who is who. Getting this wrong has already shipped an error.
2. `brand.md` — how BuildX sounds.
3. `design-system.md` — how BuildX looks.
4. `production-workflow.md` — how a project actually gets made.

**Before cutting footage:** `editorial.md`, then `broll.md`, then `captions.md`.

**Before putting a number or a claim on screen:** `verified-facts.md`, then
`terminology.md`.

**Before touching Premiere:** `CLAUDE.md` (bridge startup), then `premiere-gotchas.md`.

**Before building a graphic:** `design-system.md`, then `safe-zones.md`, then `assets.md`.

---

## File index

| File | What it holds |
|---|---|
| `README.md` | This file — scope, rules, index |
| `brand.md` | Voice, messaging, personality, CTA policy, podcast branding |
| `design-system.md` | Colour, typography, logo placement, spacing, lower thirds, hooks, visual standards |
| `safe-zones.md` | Platform safe zones — where logos, text and graphics may sit, and what the app covers |
| `production-workflow.md` | The end-to-end production process, QA checklist, publishing handoff |
| `editorial.md` | Selection, hooks, cutting judgement, shot and coverage doctrine |
| `broll.md` | B-roll standards — what covers what, and when not to cut away |
| `people.md` | Who is on camera, who is not, and how to label speakers |
| `terminology.md` | Domain glossary and the transcription correction lexicon |
| `verified-facts.md` | Pricing, statistics, recurring facts, myths vs facts, verified wording |
| `captions.md` | Caption policy — style, and the rule against guessing |
| `assets.md` | Brand assets, media libraries, composition catalogue |
| `premiere-gotchas.md` | Live-verified Premiere MCP behaviour, limits, workarounds |
| `open-questions.md` | Every unresolved decision, with what it blocks |

Files are created in the approved Phase 1 order. A file listed above but not yet present is
**planned, not missing**.

---

## The source-of-truth contract

Because Phase 1 copied nothing out of the existing documents — it only read them — some
content in this directory now exists in two places. Every file declares which case it is,
in frontmatter and again inline where it matters.

### Frontmatter

Every file in this directory carries:

```yaml
---
status: current | superseded | historical | proposed
verified: YYYY-MM-DD
source-of-truth: authoritative | mirror:<path> | mixed
---
```

- **`status`** — `current` unless stated otherwise. A file describing something not yet
  built is `proposed`.
- **`verified`** — when the content was last checked against reality. Not the edit date:
  the *confirmation* date. Anything time-varying needs one per row, not just per file.
- **`source-of-truth`** — see below.

### The three content classes

| Class | Meaning | Rule |
|---|---|---|
| **Authoritative** | Exists nowhere else in the repository. This file is the source of truth. | Edit here. |
| **Mirror** | Duplicated from a document that still exists and was not modified. | **Edit the original.** The mirror names its source inline. |
| **Pointer** | Not copied at all — one line and a reference. | Follow the link. |

Bulk content is always a pointer, never a copy. The 63-candidate pool, the 20 clip plans,
and the 97-tool no-op list are referenced, never reproduced.

A mirrored section is marked inline like this:

> *Mirrors `CLAUDE.md` — the standing rule lives there. Edit there, not here.*

---

## Unresolved items

Anything genuinely undecided is written as an explicit **`TODO`** in the file it affects,
and indexed in `open-questions.md` with what it blocks. **No file in this directory guesses
a value in order to look finished.** Three brand conflicts and one undocumented workflow are
currently open; see `open-questions.md`.

---

## How this gets read

Phase 1 did not modify `CLAUDE.md`, so **nothing loads these files automatically.** They are
read on request. Until Phase 2 wires an entry point, reference the directory explicitly at
the start of BuildX work:

> Read `knowledge/buildx/README.md` first.

This is a known limitation of an additive phase, not an oversight. Phase 2 rewrites
`CLAUDE.md` as a router into this directory.

---

## Contributing

- **Apply the inclusion test.** Project state goes in a handoff document, not here.
- **Cite the source.** When a fact comes from a repository document, name it — ideally with
  a line reference — so any claim is one jump from verification.
- **Date what changes.** Counts, prices and tool behaviour all drift. A `verified:` date
  makes a stale entry visible instead of quietly wrong.
- **Never invent to fill a gap.** Write a `TODO`, index it in `open-questions.md`, and move
  on.
- **Prefer a pointer to a copy.** Every duplicate is a future contradiction.
