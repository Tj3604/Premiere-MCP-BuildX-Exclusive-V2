# Claude Video Editor

Prompt-driven editing in Adobe Premiere Pro 2026. Claude transcribes footage, decides the
cuts, builds motion graphics as HTML, and assembles everything on a real timeline.

## Start a session

**Every time, before asking Claude to touch Premiere:**

1. Open Premiere Pro with your project.
2. `Window > Extensions > MCP Bridge (CEP)`
3. Temp directory: `/tmp/premiere-mcp-bridge`
4. Click **Start Bridge**.

Without this, Premiere tool calls hang. It is the single most common failure.

**Then, before any build step, confirm the sequence format:**

```bash
node scripts/check-sequence.mjs
```

It exits non-zero on anything that is not 29.97 / 1080×1920 and refuses to continue.
A 30 fps timeline against 29.97 source drifts invisibly until playback, and the MCP
tools that claim to fix frame rate and resolution are no-ops.

Then open this folder in Claude and prompt in plain language:

> Rough cut `/path/to/raw.mp4` and put it on the timeline. Cut it hard — only the essential parts.

> Make a lower third that says "Tom Martell / Project Manager" — stepped 8fps feel, warm
> paper texture, gold accent. Put it over the clip at 00:12.

## What's here

| Path | |
|---|---|
| `CLAUDE.md` | How the system works — the operating manual Claude reads |
| `knowledge/buildx/` | Permanent BuildX knowledge — brand, voice, editorial and production standards |
| `TOOL-RELIABILITY.md` | Which MCP tools actually work — 97 of 281 fake success |
| `scripts/transcribe.mjs` | Footage → word-level transcript (whisper.cpp) |
| `scripts/transcribe-x.mjs` | Footage → word-level transcript (WhisperX, forced alignment + VAD) |
| `scripts/plan-cut.mjs` | Keep-ranges → exact timeline placements, and optional FCP7 XML |
| `scripts/check-sequence.mjs` | **Run first.** Hard-fails if the sequence is not 29.97 / 1080×1920 |
| `scripts/new-project.mjs` | New project from the vertical template, `X#### (surname)` |
| `scripts/detect-scenes.mjs` | Video → shot list with timecodes |
| `scripts/reframe-vertical.mjs` | Horizontal footage → 1080×1920 master in `reframed/` |
| `scripts/prep-audio.mjs` | Audio prepared for transcription only — never for the edit |
| `scripts/render-graphic.mjs` | HyperFrames composition → ProRes 4444 / MP4 |
| `scripts/mcp-call.mjs` | Call any Premiere tool from the shell (bridge testing) |
| `scripts/audit-tools.mjs` | Regenerate `TOOL-RELIABILITY.md` |
| `graphics/alpha-test/` | Working transparent lower-third, use as a template |
| `mcp/premiere-pro-mcp/` | The MCP server + CEP bridge |
| `presets/` | Audio and colour treatment notes |

## Health check

```bash
cd mcp/premiere-pro-mcp && npm run setup:doctor
```

## Requirements

Node 18+ (running 26), ffmpeg, Premiere Pro 2026. Transcription and graphics rendering run
locally — no API keys, no upload.

## Uninstall

```bash
cd mcp/premiere-pro-mcp && npm run uninstall:mac
```

Removes the CEP extension and the Claude Desktop MCP entry. Delete this folder to remove
the rest.
