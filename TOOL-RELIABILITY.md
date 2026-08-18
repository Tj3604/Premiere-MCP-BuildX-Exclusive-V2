# Tool Reliability — READ BEFORE TRUSTING A TOOL RESULT

The Premiere MCP advertises **281 tools**. They are not equally real.

`src/tools/expanded.ts` ends its dispatcher with a catch-all:

```js
default:
  return ok({ accepted: true, name: toolName, args: args, note: "Expanded tool dispatched..." });
```

Any "expanded" tool without an explicit `case` returns **`success: true` and does nothing**.

## Verified against a live Premiere 2026 session

`delete_project_item` and `delete_multiple_project_items` both returned
`success: true, accepted: true` — and the item was still in the project afterwards.
They are no-ops.

## Counts

| | |
|---|---|
| Core tools (`index.ts`, really implemented) | 108 |
| Expanded, really implemented | 76 |
| **Expanded, fake-success no-ops** | **97** |

## How to tell at runtime

A response containing `"accepted": true` plus the note
`"Expanded tool dispatched through the native Premiere bridge"` means **nothing happened**.
Real tools return actual data (IDs, names, counts, durations).

Never report success to the user based on `accepted: true`. Verify with a read tool
(`get_project_info`, `list_sequence_tracks`, `list_project_items`) or do it manually.

## A third category: no tool exists at all

Beyond *real* and *fake-success no-op*, some operations have **no tool and no ExtendScript API**.
A no-op at least has a name to call; these have nothing, and no amount of MCP work will fix them.

| Operation | Evidence |
|---|---|
| **Caption creation / readback** | `app.project.activeSequence.captionTracks` returns **`undefined`** — probed live through the CEP bridge, 2026-08-18. Caption tracks are invisible to ExtendScript entirely: they cannot be created, listed, or read |

These are the operations that justify the computer-use GUI fallback. See
[`gui/SETUP.md`](gui/SETUP.md) and the computer-use section of [`CLAUDE.md`](CLAUDE.md).

**Not a tool problem, but it lands the same way:** Premiere's own *Create captions* dialog accepts
a `Minimum duration in seconds` value and then does not enforce it. With it set to 1.2, measured
caption durations ran 0.40s–1.97s, five of six sampled captions under the minimum. Caption
boundaries are inherited from the transcript segment timings. Do not report the dialog's settings
as properties of the output — measure the output.

## The 97 no-op tools

- `add_adjustment_layer`
- `add_custom_metadata_field`
- `add_marker_to_project_item`
- `attach_custom_property`
- `batch_apply_effect`
- `batch_enable_disable`
- `batch_rename_clips`
- `clear_sequence_in_out`
- `close_project`
- `close_sequence`
- `consolidate_and_transfer`
- `copy_effect_values`
- `copy_effects_between_clips`
- `create_bars_and_tone`
- `create_sequence_from_clips`
- `create_sequence_from_preset`
- `create_smart_bin`
- `delete_bin`
- `delete_multiple_project_items`
- `delete_preview_files`
- `delete_project_item`
- `detach_proxy`
- `encode_file`
- `encode_project_item`
- `execute_extendscript`
- `export_as_project`
- `export_omf`
- `freeze_frame`
- `get_clip_adjustment_layer`
- `get_export_file_extension`
- `get_linked_items`
- `get_mogrt_component`
- `get_value_at_time`
- `has_proxy`
- `import_ae_comps`
- `import_image_sequence`
- `import_sequences`
- `invert_selection`
- `move_clip_to_track`
- `move_items_to_bin`
- `move_playhead_to_edit`
- `nest_clips`
- `overwrite_clip`
- `razor_all_tracks`
- `remove_all_effects`
- `remove_effect`
- `remove_effect_by_name`
- `remove_keyframe_range`
- `rename_bin`
- `replace_clip_media`
- `ripple_delete`
- `roll_edit`
- `scene_edit_detection`
- `select_clips_by_color`
- `select_item`
- `set_all_tracks_targeted`
- `set_anti_alias_quality`
- `set_blend_mode`
- `set_clip_anchor_point`
- `set_clip_opacity`
- `set_clip_pan`
- `set_clip_position`
- `set_clip_rotation`
- `set_clip_scale`
- `set_clip_speed_qe`
- `set_clip_start_time`
- `set_clip_volume`
- `set_color_value`
- `set_effect_property`
- `set_frame_blend`
- `set_graphics_white_luminance`
- `set_keyframe_interpolation`
- `set_offline`
- `set_override_frame_rate`
- `set_override_pixel_aspect_ratio`
- `set_poster_frame`
- `set_project_panel_metadata`
- `set_project_scratch_disk`
- `set_scale_to_frame_size`
- `set_scale_width_height`
- `set_scratch_disk_path`
- `set_sequence_audio_settings`
- `set_sequence_display_format`
- `set_sequence_field_type`
- `set_sequence_frame_rate`
- `set_sequence_pixel_aspect_ratio`
- `set_sequence_resolution`
- `set_start_time`
- `set_time_interpolation`
- `set_transcode_on_ingest`
- `set_uniform_scale`
- `set_xmp_metadata`
- `set_zero_point`
- `slide_edit`
- `slip_edit`
- `start_batch_encode`
- `unnest_sequence`

## The 76 expanded tools that are really implemented

- `add_tracks`
- `capture_frame`
- `clear_item_in_out`
- `close_all_source_clips`
- `close_source_monitor`
- `deselect_all_clips`
- `evaluate_expression`
- `extract_selection`
- `find_items_by_media_path`
- `get_all_project_paths`
- `get_bin_contents`
- `get_clip_at_playhead`
- `get_clip_links`
- `get_clip_markers`
- `get_clip_speed`
- `get_color_space`
- `get_duplicate_media`
- `get_effect_properties`
- `get_encoder_presets`
- `get_full_clip_info`
- `get_full_project_overview`
- `get_full_sequence_info`
- `get_graphics_white_luminance`
- `get_insertion_bin`
- `get_item_info`
- `get_next_edit_point`
- `get_offline_media`
- `get_premiere_state`
- `get_project_item_info`
- `get_project_panel_metadata`
- `get_project_scratch_disks`
- `get_qe_clip_info`
- `get_sequence_count`
- `get_sequence_markers_by_type`
- `get_sequence_structure`
- `get_source_monitor_info`
- `get_source_monitor_position`
- `get_target_tracks`
- `get_timeline_gaps`
- `get_timeline_summary`
- `get_total_clip_count`
- `get_track_info`
- `get_unused_media`
- `get_used_media_report`
- `get_version_info`
- `get_workspaces`
- `get_xmp_metadata`
- `insert_from_source`
- `inspect_dom_object`
- `is_work_area_enabled`
- `lift_selection`
- `link_selection`
- `list_clip_effects`
- `match_frame`
- `multiple_undo`
- `open_in_source`
- `overwrite_from_source`
- `ping`
- `play_source_monitor`
- `play_timeline`
- `redo`
- `remove_selected_clips`
- `rename_clip`
- `rename_track`
- `search_project_items`
- `select_all_clips`
- `select_clips_by_name`
- `select_clips_in_range`
- `select_disabled_clips`
- `set_clip_selection`
- `set_item_in_out`
- `set_source_in_out`
- `set_target_track`
- `set_workspace`
- `stop_playback`
- `unlink_selection`

> Regenerate this file after updating the MCP server:
> `node scripts/audit-tools.mjs`
