# BuildX Production Architecture

## Core rule
Never edit the master sequence destructively. Every workflow begins by duplicating the sequence or creating a new sequence from source ranges.

## Pipeline
1. Inspect active master sequence and identify nested/multicam clips.
2. Read transcript with speaker names and exact word timecodes.
3. Generate broad candidate windows across the entire master timeline.
4. Score hook, authority, emotion, utility, clarity, completeness, novelty, and likely retention.
5. Deduplicate overlapping candidates while retaining alternate hook constructions.
6. Build constructed shorts using exact quotes only: hook, setup, proof, payoff.
7. Generate an edit-decision list before touching Premiere.
8. Create a duplicate short sequence and assemble selected source ranges.
9. Apply speaker-aware multicam cuts with minimum/maximum shot rules.
10. Reframe to 9:16, add captions, BuildX graphics, CTA, logo, and export only after review.

## Required production safeguards
- Dry-run is the default.
- Master sequences are read-only.
- Every generated sequence includes BUILDX_AI and a timestamp in its name.
- All source quotes and timecodes are logged.
- Constructed shorts cannot change word order inside a spoken segment.
- No reaction shot may imply a reaction from a different conversational moment.
- No automatic export until a human approves the sequence.
