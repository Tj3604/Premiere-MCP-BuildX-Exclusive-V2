# Multicam Specification

## Inputs
- Multicam source sequence or already-cut master sequence.
- Speaker-labeled transcript.
- Camera map: angle number, speaker, wide/two-shot/B-roll type.
- Optional face and audio activity confidence.

## Decision hierarchy
1. The active speaker's clean single camera.
2. Buz's camera for a Buz-led opening hook.
3. Wide shot for conversational setup, interruptions, or uncertain diarization.
4. Reaction shot only when temporally authentic and visually usable.
5. B-roll only when it supports the exact sentence and does not hide essential emotion.

## Retention rules
- Avoid shots under 2.4 seconds unless correcting an interruption.
- Break static shots around 8-13 seconds, based on sentence structure rather than a timer alone.
- Never alternate cameras mechanically after every sentence.
- Cut on thought changes, emphasis, question/answer transitions, and emotional reactions.
- Preserve J-cuts and L-cuts where they improve flow.
- Use punch-ins only as a secondary layer; do not fake additional camera angles.

## Master timeline support
The analyzer must preserve source time and sequence time. When the master contains multicam or nested clips, the integration layer must resolve sequence time back to source ranges before creating a short.
