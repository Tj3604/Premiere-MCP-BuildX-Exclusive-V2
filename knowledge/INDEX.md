> Index of every knowledge file the Premiere MCP can read: what it covers, when to open it, and its resource URI. Check this first and open only the files the task needs.

# Knowledge Index

Read a file through its URI (`readResource`). Tracked files live under `knowledge/`.
Private files live under `$BUILDX_PRIVATE_DIR` (default `<repo>/private`, gitignored), so
they exist only on machines that hold the private data. If one is missing, say so instead of guessing.

## Start here

| Task | Open, in order |
|---|---|
| First BuildX work in a session | people → brand → design-system → production-workflow |
| Planning a new short or longform | video-formats (private) → `find_similar_videos` tool → editorial |
| Writing or picking a hook | `check_hook` tool → `list_hooks` tool → editorial |
| Cutting footage | editorial → broll → captions |
| Captions | captions → terminology → safe-zones |
| A number or claim on screen | verified-facts → terminology |
| Building a graphic | design-system → safe-zones → assets |
| Touching Premiere | premiere-gotchas |
| Multicam or podcast shorts mining | PRODUCTION_ARCHITECTURE → SHORTS_ENGINE_SPEC → MULTICAM_SPEC |

## BuildX doctrine — `knowledge/buildx/`

| File | Covers | Use when | URI |
|---|---|---|---|
| README.md | Scope of the knowledge base, inclusion test, reading order | Unsure whether something belongs in knowledge | `buildx://knowledge/file/buildx/README.md` |
| people.md | On-camera identities, speaker labels | Labelling speakers, lower thirds, any transcript | `buildx://knowledge/file/buildx/people.md` |
| brand.md | Voice, messaging, CTA policy, podcast branding | Writing any on-screen or spoken copy | `buildx://knowledge/file/buildx/brand.md` |
| design-system.md | Colour, type, logo placement, lower thirds, hook graphics | Placing a logo or building any graphic | `buildx://knowledge/file/buildx/design-system.md` |
| safe-zones.md | Platform UI zones and where text and graphics may sit | Positioning captions, logos, graphics in 9:16 | `buildx://knowledge/file/buildx/safe-zones.md` |
| production-workflow.md | End-to-end process, QA checklist, publishing handoff | Starting a build or preparing delivery | `buildx://knowledge/file/buildx/production-workflow.md` |
| editorial.md | Selection, hooks, cutting judgement, pacing | Choosing what survives a cut | `buildx://knowledge/file/buildx/editorial.md` |
| broll.md | When to cut away, what to cut to | Placing b-roll over dialogue | `buildx://knowledge/file/buildx/broll.md` |
| captions.md | Caption style, accuracy, emphasis | Generating or styling captions | `buildx://knowledge/file/buildx/captions.md` |
| terminology.md | Domain glossary, transcription corrections | Fixing transcripts and caption text | `buildx://knowledge/file/buildx/terminology.md` |
| verified-facts.md | Pricing, statistics, verified wording | Any number or claim on screen | `buildx://knowledge/file/buildx/verified-facts.md` |
| assets.md | Where brand assets and media libraries live | Finding a logo, font, end card, b-roll library | `buildx://knowledge/file/buildx/assets.md` |
| premiere-gotchas.md | Live-verified Premiere MCP limits and workarounds | Before any Premiere operation that failed or looks risky | `buildx://knowledge/file/buildx/premiere-gotchas.md` |
| open-questions.md | Unresolved decisions and what they block | A rule seems missing or contradictory | `buildx://knowledge/file/buildx/open-questions.md` |

## Pipeline specs — `knowledge/`

| File | Covers | Use when | URI |
|---|---|---|---|
| PRODUCTION_ARCHITECTURE.md | Non-destructive pipeline from master to shorts | Mining shorts from a master sequence | `buildx://knowledge/file/PRODUCTION_ARCHITECTURE.md` |
| SHORTS_ENGINE_SPEC.md | Candidate types and scoring for shorts | Ranking short candidates | `buildx://knowledge/file/SHORTS_ENGINE_SPEC.md` |
| MULTICAM_SPEC.md | Camera-choice rules for multicam edits | Cutting a multi-angle podcast | `buildx://knowledge/file/MULTICAM_SPEC.md` |
| INTEGRATION_WITH_EXISTING_MCP.md | How BuildX tools layer on the upstream MCP | Adding or registering MCP tools | `buildx://knowledge/file/INTEGRATION_WITH_EXISTING_MCP.md` |

## Video library

| File | Covers | Use when | URI |
|---|---|---|---|
| library/video-entry.schema.json | Fields recorded for every past video | Adding or reading library entries | `buildx://library/schema` |
| Library index (private) | One row per past video: hook, length, date, views | Browsing past work | `buildx://library/index` |
| One library entry (private) | A single past video in full | Opening a result from `find_similar_videos` | `buildx://library/entry/<slug>` |

## Private notes — `$BUILDX_PRIVATE_DIR/knowledge/`

| File | Covers | Use when | URI |
|---|---|---|---|
| video-formats.md | Every format BuildX ships, the current end card, delivery naming, known inconsistencies | Deciding what a new piece should look like | `buildx://private/knowledge/video-formats.md` |
