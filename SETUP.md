# BuildX Claude Video Editor --- Setup Guide

## Purpose

This repository contains the BuildX knowledge system, Claude
configuration, and Premiere Pro workflow used for AI-assisted video
editing.

## Requirements

### Software

-   Claude Desktop
-   Adobe Premiere Pro 2026
-   Premiere MCP Bridge
-   Node.js (latest LTS recommended)
-   Git

### Access

-   BuildX GitHub repository
-   BuildX Dropbox (or shared asset location)
-   Appropriate permissions for the Premiere MCP Bridge

## Repository Structure

-   CLAUDE.md
-   README.md
-   HANDOFF.md
-   SHORTS-HANDOFF.md
-   SHORTS-CANDIDATES.md
-   SHORTS-PLAN.md
-   TOOL-RELIABILITY.md
-   knowledge/
-   scripts/
-   mcp/
-   presets/

## Initial Setup

1.  Clone the repository.
2.  Install any required dependencies.
3.  Start the Premiere MCP Bridge.
4.  Open Adobe Premiere Pro.
5.  Open the Premiere project you want to edit.
6.  Confirm the bridge is connected.
7.  Launch Claude Desktop.

## First Validation

Before editing, verify the connection.

Example prompt:

> Connect to Premiere and verify the active project. Confirm the bridge
> is connected, identify the active project and sequence, and report any
> issues before making changes.

## Daily Workflow

1.  Open Premiere.
2.  Open the desired project.
3.  Start the MCP Bridge.
4.  Open Claude Desktop.
5.  Give a high-level editing instruction.

Example:

> Connect to Premiere and create 20 BuildX social shorts from these
> customer stories. Intercut different customers where it strengthens
> the narrative and builds BuildX authority.

## Best Practices

-   Verify the active project before editing.
-   Use duplicate or scratch sequences when testing.
-   Follow the BuildX knowledge base.
-   Record unexpected MCP behavior.
-   Update documentation after validation.

## Troubleshooting

-   Verify the MCP Bridge is running.
-   Ensure Premiere is open.
-   Confirm the correct project is active.
-   Reconnect before retrying.

## Version

BuildX Claude Video Editor v1.0
