# CONTRIBUTING.md

# Contributing to the BuildX Claude Video Editor

Thank you for helping improve the BuildX AI editing system.

## Philosophy

The repository is designed around three layers:

-   **CLAUDE.md** --- Routing and conversation entry point.
-   **knowledge/** --- BuildX policies, standards, editorial guidance,
    and documentation.
-   **Skills / MCP Tools** --- Execution of tasks inside Premiere Pro.

Keep these responsibilities separate.

## Before Making Changes

Ask yourself:

-   Is this BuildX policy?
-   Is this a reusable editing procedure?
-   Is this documenting actual Premiere behavior?
-   Is this a temporary project-specific workaround?

Only permanent knowledge belongs in the repository.

## Documentation Standards

-   Prefer updating existing documents instead of creating new ones.
-   Avoid duplicate information.
-   Keep examples concise.
-   Record observed behavior rather than assumptions.

## Validation First

When Premiere behavior changes:

1.  Reproduce it.
2.  Validate it.
3.  Document the finding.
4.  Update the repository only after validation.

## Pull Requests

Every change should explain:

-   What changed
-   Why it changed
-   Whether validation was performed

## Repository Goal

The goal is not simply to automate editing.

The goal is to create a reliable, maintainable BuildX editing system
that improves over time.
