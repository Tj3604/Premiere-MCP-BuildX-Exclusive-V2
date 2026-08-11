# SHORTS MANIFEST — Lemon Testimonial

Source: `~/Downloads/Lemon Testimonial V1.mp4` (4096x2160, 29.97fps)
Speaker: **Michael Lemon**, Whitman MA — BuildX ADU customer.
Project: `Lemon Jobsite Update.prproj`. All sequences 1080x1920 @ 30fps.

Track layout: V1 footage + CTA end card · V3 BuildX logo · V4 lower third · V5 topic card (where present).

Lower third: `lt-id-b-rule` — 10px gold left rule, **BUILDX CUSTOMER / MIKE LEMON**, no town,
positioned low (top 1200px of 1920). Logo reduced to scale 40 at y=0.062.

Topic cards are deliberately four different formats — design-system.md treats a batch of
identical cards as a failure mode.

| # | Sequence | Footage | +CTA | Topic graphic |
|---|---|---|---|---|
| 1 | SHORT 01 - perfect-solution | 23.0s | 28.0s | — |
| 2 | SHORT 02 - days-behind-me | 19.8s | 24.8s | — |
| 3 | SHORT 03 - ten-miles-away | 18.4s | 23.4s | — |
| 4 | SHORT 04 - one-floor | 23.1s | 28.1s | lt-g7-one-floor (checklist) |
| 5 | SHORT 05 - go-look | 23.3s | 28.3s | — |
| 6 | SHORT 06 - no-misleading | 16.3s | 21.3s | lt-t06-statement (full-frame statement) |
| 7 | SHORT 07 - start-to-finish | 18.6s | 23.6s | — |
| 8 | SHORT 08 - had-the-answers | 19.8s | 24.8s | lt-t08-sidepanel (left side panel) |
| 9 | SHORT 09 - zoning-board | 23.2s | 28.2s | lt-t09-checklist (building checklist) |
| 10 | SHORT 10 - paying-as-we-go | 13.9s | 18.9s | — |
| 11 | SHORT 11 - no-excuses | 16.7s | 21.7s | lt-t11-twotone (problem → payoff) |
| 12 | SHORT 12 - on-schedule | 18.4s | 23.4s | — |
| 13 | SHORT 13 - house-that-sold-us | 24.2s | 29.2s | — |
| 14 | SHORT 14 - three-words | 20.4s | 25.4s | lt-g2-three-words (numbered list) |

## Question segments (added)

Seven shorts open on a 2.6s question card. Each bakes in a **freeze of that short's own
first frame** (reframed to match), so the cut from still to motion is seamless. Full-frame
MP4 on V1 at 0-2.6s; everything else shifted +2.6s.

| Short | Question | New total |
|---|---|---|
| 01 | How does this ADU help your **family**? | 30.5s |
| 02 | What is the benefit to your **life** from an ADU? | 27.4s |
| 03 | What was the **alternative** to an ADU? | 26.0s |
| 04 | Why did you **choose** an ADU? | 30.7s |
| 06 | What was most **surprising** about BuildX? | 23.9s |
| 10 | How are you **financing** the ADU? | 21.5s |
| 14 | What are **3 words** to describe BuildX? | 27.9s |

These are BuildX framing copy, not attributed dialogue — they are not presented as
questions asked on camera, so the exact-quote rule does not apply to them.

> **Do not use `insertMode: "insert"` on these sequences.** Tested live: it truncated the
> footage by 3s, split the clip, and left audio and overlay tracks unshifted — desyncing
> audio by the insert length. `undo` did not fully restore it. Shift by remove + re-add
> with explicit times instead. Note also that lifting a video clip leaves its linked audio
> behind as an orphan; remove it explicitly.


---

## Per-beat source manifest

### 01 — This is like a perfect solution
Sequence id `147a017c…`

- `36.30–59.16` — "My wife is disabled so we'll be closer to some people that can offer assistance that they have to. This is like a perfect solution. If I'm not around, obviously my daughter and grandson live here and my sister lives next door so this is much more convenient if we need a little more assistance."

### 02 — Those days are behind me
Sequence id `118d77b3…`

- `275.14–294.85` — "It makes your life a lot easier thinking that I'm going to be taking care of a little smaller house that has everything that we need in it really and there's not the thinking about putting a 28-foot ladder up on the side of the house, the clean gutters are doing any of that. Those days are behind me,"

### 03 — What I would have done instead
Sequence id `b565e21f…`

- `396.52–414.80` — "I don't know what I would have done, to be honest, I probably would have tried to buy a smaller house, which would have been not a good thing to do because that would have been maybe 10 miles away, I don't know, that certainly wouldn't be as convenient as this. I have a great daughter that will keep an eye on us."

### 04 — A big old house I don't need
Sequence id `d5377f3c…`

- `25.44–36.24` — "Some health reasons, both myself and my wife and age, it's getting hard to take care of a big old house that I just don't need anymore."
- `308.10–312.50` — "It's all one floor, it's a handicapped accessible bathroom."
- `318.58–326.20` — "Overall, just a much more user-friendly layout and no stairs to speak of."

### 05 — Go check out what they've built
Sequence id `7e66ee58…`

- `59.22–73.14` — "To be honest, my daughter saw their advertisement and we went out and looked at some of the ADUs that they had built and we were impressed with the quality of the workmanship"
- `330.94–340.15` — "I would tell them to go check out what the builders have done before. I think that that speaks volumes for build-ex."

### 06 — No misleading statements
Sequence id `51ae7c97…`

- `160.84–177.00` — "What kind of surprised me was what they told us, even though it may not have been exactly what I would have liked, there was no misleading statements made. Everything was pretty clear cut and forward and very positive, very positive,"

### 07 — They do everything start to finish
Sequence id `dda85c94…`

- `235.90–239.76` — "I think it's the fact that they do everything start to finish."
- `179.20–193.70` — "I mean, you can really kind of sit back and enjoy the whole situation, the whole building of a house without worrying about anything, you know, licensing everything, we're just sitting here, have a question, you call them, they get back to you."

### 08 — Buz had the answers to everything
Sequence id `db210c02…`

- `118.02–137.68` — "Buzz had the answers to everything. He didn't say I have to go check something or get back to it. He knew what every aspect of it was and it helped us formulate the house itself, how big we wanted it to be and they told us we could have any type of arrangement we wanted"

### 09 — The zoning board meeting
Sequence id `f0ef6234…`

- `193.76–216.88` — "We did attend the meeting, the zoning board meeting and it was pretty complicated but they had a tremendous presentation. Everybody was there, the people that did the land surveying, any questions that the board had, they had answers to. So it was a very smooth meeting. I didn't have to do anything, which I liked."

### 10 — How we're paying for it
Sequence id `b12cbf06…`

- `104.14–117.96` — "We're going to be selling a house and that will help finance it. As a matter of fact, I've taken out a home equity line of credit on my house and we're paying as we go."

### 11 — They didn't use it as an excuse
Sequence id `1e1eb056…`

- `445.12–452.15` — "I know they had a problem with one of the permits they had, they changed what the town changed what they needed to do."
- `462.58–472.08` — "That would have been an excuse for some people, but they didn't use it as an excuse, they just overcame it and were marching on."

### 12 — The team deserves all the credit
Sequence id `14bffe51…`

- `414.86–433.20` — "The build-ex team deserves all the credit in the world and the builders, the guys that do the work, they put in some long days, I'm really surprised how long they work. They've got a lot done and we're right on schedule to move in at the end of September."

### 13 — The house that convinced them
Sequence id `b89051dd…`

- `354.38–372.10` — "It was a house that the parents had built for a health challenge daughter. She explained the process and we took away some of the aspects of that house because it had a good sized bathroom, plenty of room to move a wheelchair around and stuff."
- `375.78–382.10` — "When we left there, I felt that we were probably going to do this build."

### 14 — Listening. Quality. Character.
Sequence id `ccc3e6a6…`

- `472.14–492.44` — "I would say the most important word would be listening. The second thing is quality and the third thing would be character, living up to what they say they're going to do, they do it. Just build baby."

---

## Verification notes

- Cut points generated by `scripts/plan-cut.mjs` (integer-frame math); no offsets hand-computed.
- Graphics render as ProRes 4444 with a real alpha channel. Verified with ffmpeg that mean
  alpha in the card region is **0 before every reveal** and 200+ after — so no card appears
  before its line is spoken (design-system.md timing rule).
- Gold `#D9A441`, Anton + Archivo — matched to the existing `graphics/` family
  (design-system.md TODO-DS1/DS2 remain open; nothing new was invented).

## Unresolved / cut for accuracy

- **"a bitch joined us"** `433.26–435.02` — garbled at both small.en and medium.en.
  Cut per captions.md rather than guessed. Short 11 starts after it.
- **"Bill Dixon" / "Bill Lex"** `88.80–89.73` — the two models disagree; almost certainly
  "BuildX". Left off screen and excluded from every clip.
- **"Buzz"** — people.md spells the BuildX rep **Buz**. Spoken audio only; not on screen.
- **Mike / Chris** `77.0–80.0` — unconfirmed; excluded from short 05 (ends at "workmanship").
