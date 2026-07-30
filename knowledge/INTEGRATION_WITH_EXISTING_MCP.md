# Integration With hetpatel-11 Adobe Premiere Pro MCP

The upstream project already provides the Premiere bridge and a broad tool catalog. This expansion should be added as a BuildX workflow layer rather than replacing those tools.

## Recommended additions to the upstream fork
1. Add `src/buildx/` containing the analysis and multicam modules from this package.
2. Register high-level MCP tools:
   - `buildx_inspect_master_timeline`
   - `buildx_mine_all_shorts`
   - `buildx_build_constructed_short`
   - `buildx_plan_multicam_edit`
   - `buildx_create_short_sequences`
   - `buildx_apply_multicam_plan`
   - `buildx_finish_vertical_short`
   - `buildx_validate_generated_short`
3. Map adapter methods to existing upstream sequence, marker, multicam, caption, MOGRT, and export tools.
4. Add dry-run and transaction logging to every high-level workflow.

## Critical integration work still requiring a live Premiere machine
- Confirm the exact upstream tool schemas and internal registration APIs.
- Resolve nested and multicam sequence time to source time.
- Verify angle-switch operations against your actual master sequence format.
- Read Premiere transcript/speaker data reliably.
- Test MOGRT paths, fonts, CTA, logo, caption styling, and export presets.
