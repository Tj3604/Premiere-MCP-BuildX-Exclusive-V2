VIDEO TEMPLATES — READ THIS FIRST
=================================

One .txt per video type BuildX ships. Each file has two halves:

  BRIEF   — blanks to fill in (or that Claude fills in by asking / inspecting the footage).
  RECIPE  — the fixed build order, house settings and traps for that format.

HOW TO USE
----------
  Tell Claude:  "Make a <type> from <footage path>. Use templates/<file>.txt"
  or paste a filled-in BRIEF block into the prompt.

  Claude must:
    1. Read this README, then the matching template, then 99-qa-checklist.txt.
    2. Fill every BRIEF blank it can from the footage/project. ASK only for blanks it
       cannot determine (never guess names, places, prices or the delivery folder).
    3. Follow the RECIPE in order. Where a step says "read knowledge/...", read it.
    4. Stop at PROOF-WATCH. Thomas watches in Premiere before anything is exported.

  Customer names, addresses and transcripts never go in this folder (public repo).
  Put a filled-in brief for a real job in private/briefs/ instead.

PICK A TEMPLATE
---------------
  01-tour-edu-shorts.txt        Buz/PM on site → many single-topic 9:16 shorts
  02-faq-shorts.txt             Visitor asks, Buz answers (open-house / tour Q&A)
  03-testimonial.txt            Customer interview → full cut + shorts
  04-reaction.txt               Buz reacting to a third-party clip (short or longform)
  05-pm-jobsite-update.txt      PM narration + phone clips → 9:16 educational update
  06-weekly-recap.txt           JobTread photos/video → 15s+ weekly 9:16 recap
  07-walkthrough-longform.txt   16:9 walkthrough / home tour longform
  08-studio-qa-longform.txt     Studio Q&A / S7-style longform with question cards
  09-podcast-shorts.txt         Podcast/studio master → shorts
  10-ads.txt                    YouTube ads, Comcast 30s spots
  99-qa-checklist.txt           Run before saying "done" on ANY of the above

RULES THAT APPLY TO EVERY TEMPLATE (non-negotiable)
---------------------------------------------------
  - Exact spoken dialogue only. Never invent, reword or paraphrase a line.
  - Cut on measured silence at whole sentences; no clipped words. Prove it by
    transcribing the finished sequence audio.
  - No name, place or number on screen unless confirmed (people.md, verified-facts.md).
  - Logo on V3 on every edit, unbroken to the end card. Never razor/fade it to dodge a
    full-screen graphic.
      9:16 1080x1920 : Position [0.79444, 0.16042]  Scale 31  (upper-right)
      16:9 1920x1080 : Position [0.86927, 0.10602]  Scale 31  (top-right)
    Set with set_param_value (set_clip_position/scale are no-ops).
  - Every video ends on the START YOUR ADU JOURNEY card:
      9:16  buildx-cta-adu-journey-9x16-ig-v3.mov
      16:9  ADU Journey 16x9 v3
    Never author a new CTA. Logo track ends where the card starts.
  - Frame 0 of every short is a 1-frame DESIGNED cover (hero still + headline,
    white with a gold payoff word, gold rule). Then straight into the hook.
  - No music on dialogue shorts. No blurred-copy backgrounds. No black bars — fill the
    frame (cropdetect the delivered file).
  - Positive-only jobsite content: no unfinished/exposed work, redos, tear-outs, crew down
    in a trench or excavation. Any soft-focus stretch gets B-roll (blurdetect V1).
  - Walls are "thin coat plaster" — never write "drywall". When GFA is explained, say it is
    measured to the inside face of the outside walls.
  - Footage traps: Osmo Pocket 4 / DJI home-tour footage is D-Log even when tagged bt709
    (D-21 LUT via source input LUT + Lumetri exposure ~+0.6, then white balance);
    DJI_*_video.mov are rotated 90°; selfie clips may be mirrored — check before cutting.
  - Thomas edits the same project. Diff the live timeline before EVERY write pass; never
    clear a track. Confirm get_project_info before every build step (the bridge follows
    whichever project is frontmost).
  - Never overwrite a rendered MOV/MP4 in place — new unique filename every render.
  - Telemetry: start_telemetry_session at the start, set_current_video per video.
