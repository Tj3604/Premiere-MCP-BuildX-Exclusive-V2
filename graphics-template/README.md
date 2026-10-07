# graphics-template

Shared BuildX graphic templates. Each one reads the brand from `tokens.css` and takes its text from parameters, so a new graphic never re-types a colour, a font or a safe-zone value.

| Template | What | Render |
|---|---|---|
| `lower-third/` | Gold eyebrow over a name on a soft panel. 9:16 sits in the free band above the captions; 16:9 sits bottom-left. | overlay, `--alpha` |
| `question-card/` | Full-frame card: gold bar, eyebrow, question with one gold `*word*`. | full-frame |
| `cta/` | The standard end card ("Start Your ADU Journey" checklist) at 9:16 or 16:9. **The wording is fixed. BuildX never authors a new CTA.** | full-frame, 8.008 s |

```bash
node scripts/graphic-from-template.mjs --list
node scripts/graphic-from-template.mjs --template question-card \
  --set eyebrow="Ask Buz" --set question="Do you need a *permit* for an ADU?" \
  --out graphics/q-permit                # --format 16x9 for landscape
node scripts/render-graphic.mjs graphics/q-permit --fps 30000/1001 --name q-permit
```

The generator copies the template into a **new** folder, inlines `tokens.css`, HTML-escapes the text, and refuses to write into a folder that already exists. Nothing in `graphics/` is ever edited.

**Tokens:** gold `#FFB81C`, panel `#0B0B0C`, Poppins 700/800. These are the current house values, taken from the current shorts graphics and the end card and chosen by Thomas on 2026-10-06. `design-system.md` TODO-DS1 still lists the older golds. To change the brand, change `tokens.css` once.

**Safe bands (1080x1920):** logo y248–368; graphics in y410–880; captions from y909; action rail beyond x920. The templates shrink long text to fit their band rather than spill out of it.
