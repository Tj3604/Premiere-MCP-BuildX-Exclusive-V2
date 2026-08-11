# BuildX Claude Video Editor — Setup Guide

## Purpose

This repository contains the BuildX knowledge system, Claude configuration, and
Premiere Pro workflow used for AI-assisted video editing.

## Where it runs

**Entirely on the editor's own machine.** The MCP server is a local Node process,
and it drives Premiere through a CEP panel that passes messages via a shared temp
directory. There is no hosted service and nothing to deploy — it has to be local,
because it controls the copy of Premiere running in front of you.

## Which AI app

**Claude Code.** The repo is configured for it: `.mcp.json` (project-scoped MCP
server), `.claude/skills/`, and `CLAUDE.md` are all Claude Code conventions.

It is **not** set up for Claude Desktop, Cursor, or any other client. Those use a
different config format and would need the server registered by hand.

## Requirements

| Requirement | Notes |
|---|---|
| **Node.js ≥ 18** | Declared in `mcp/premiere-pro-mcp/package.json` |
| **Adobe Premiere Pro 2026** | Plus the bundled CEP panel — installed by `npm run setup:mac` |
| **ffmpeg on `PATH`** | Alpha ProRes transcode, and `detect_silence` |
| **Network access** | First run only: `transcribe.mjs` and `render-graphic.mjs` both invoke `npx hyperframes@latest` |
| **macOS** | The only setup scripts provided are `install-macos.sh` and `doctor-macos.sh` |
| **Adobe Media Encoder** | Optional — only for `get_render_queue_status` |

**No Python is required.**

## Initial Setup

```bash
# 1. Clone, then install and build the MCP server.
cd mcp/premiere-pro-mcp
npm install
npm run build          # REQUIRED — see below
npm run setup:mac      # installs the CEP panel AND generates .mcp.json
npm run setup:doctor   # verifies the install
```

`setup:mac` generates `.mcp.json` for you. If you skip it, generate that file
by hand before launching Claude Code — see [Generate `.mcp.json`](#generate-mcpjson).

### `npm run build` is not optional

`dist/` is gitignored, so a fresh clone has **no compiled server at all** — the
path `.mcp.json` points at will not exist until you build.

It also carries a local patch. `set_param_value` was added to
`src/tools/index.ts` because the stock server cannot set 2D parameters: its
`add_keyframe` takes a single number, so Position (`[x, y]`) is rejected, and
every stock position/scale tool is a silent no-op. That source patch **is**
committed, so everyone gets it — but it only takes effect once compiled.

Skip the build and logo placement will appear to succeed and do nothing.

Rebuild any time you change the server source.

### Generate `.mcp.json`

`.mcp.json` is **not** in the repo — it holds an absolute path to your clone, so
it cannot be shared. `.mcp.json.example` is the tracked template, and `.mcp.json`
is gitignored. `npm run setup:mac` generates it; to do it separately:

```bash
node scripts/init-mcp-config.mjs           # writes .mcp.json for this clone
node scripts/init-mcp-config.mjs --force   # overwrite an existing one (e.g. after moving the repo)
```

Without it Claude Code starts with no `premiere-pro` server and every Premiere
tool is simply missing.

**A relative path does not work here, so don't "fix" it to one.** Claude Code
resolves `args` against the process working directory, not the project root — a
relative path connects when you launch Claude from the repo root and fails from
any subdirectory. `${CLAUDE_PROJECT_DIR}` is a hooks-only variable and is not
expanded in `.mcp.json` either. The path has to be absolute, which is why it is
generated rather than committed.

Verify it at any time:

```bash
claude mcp list    # expect: premiere-pro: ... ✔ Connected
```

## Starting a session

**Every time, before asking Claude to touch Premiere:**

1. Open Premiere Pro with your project.
2. `Window > Extensions > MCP Bridge (CEP)`.
3. Set the temp directory to `/tmp/premiere-mcp-bridge`.
4. Click **Start Bridge** and confirm the panel shows it running.
5. Launch Claude Code in the repo directory.

If tool calls hang or time out, this is the cause roughly 90% of the time. Check
the panel before debugging anything else; right-click → `Reload` if it looks stuck.

**The bridge follows whatever project is frontmost, and it has silently switched
projects mid-session.** Confirm the project name with `get_project_info` before
every build step — not just once at the start.

## First validation

> Connect to Premiere and verify the active project. Confirm the bridge is
> connected, identify the active project and sequence, and report any issues
> before making changes.

## Before you trust a tool result

**97 of the 281 tools report success without doing anything.** A response
containing `"accepted": true` and *"Expanded tool dispatched through the native
Premiere bridge"* means nothing happened. Read `TOOL-RELIABILITY.md` before
relying on any result, and confirm writes with a read-back call.

Live-verified behaviour is in `knowledge/buildx/premiere-gotchas.md`. Where that
and `TOOL-RELIABILITY.md` disagree, live observation wins.

## Repository structure

```
CLAUDE.md          routing + standing rules — read first
README.md          overview and workflows
SETUP.md           this file
CHANGELOG.md       version history
TOOL-RELIABILITY.md  which tools actually work
HANDOFF.md, SHORTS-*.md  project handoffs and plans
knowledge/         BuildX knowledge base (not auto-loaded — read as directed)
graphics/          one HyperFrames composition per subfolder
.mcp.json.example  template for the gitignored, per-clone .mcp.json
scripts/           init-mcp-config, transcribe, plan-cut, render-graphic, mcp-call, audit-tools
mcp/               Premiere Pro MCP server + CEP bridge source
presets/           reusable look/audio settings
captions/          caption assets
footage/           raw source video (gitignored)
transcripts/       generated transcripts (gitignored)
renders/           rendered output (gitignored)
```

## Best practices

- Verify the active project before editing.
- Use duplicate or scratch sequences when testing.
- Follow the BuildX knowledge base rather than inventing a style.
- Record unexpected MCP behaviour in `premiere-gotchas.md`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Tool calls hang | Bridge panel open and started; temp dir correct |
| No Premiere tools at all | `.mcp.json` exists — `node scripts/init-mcp-config.mjs` |
| Server won't start | `npm run build` has been run; `claude mcp list` shows it connected |
| Worked, then stopped after moving the repo | `node scripts/init-mcp-config.mjs --force` |
| Position/scale does nothing | Using `set_param_value`, and the server was rebuilt after patching |
| Alpha renders as a black box | Composition sets `background:transparent`, and `--alpha` was passed |
| Graphic renders blank | Run `npx hyperframes@latest lint` — usually a timing-attribute error |

## Version

BuildX Claude Video Editor v2.2
