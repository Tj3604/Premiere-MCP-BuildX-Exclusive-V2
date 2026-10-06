/**
 * MCP Resources for Adobe Premiere Pro
 * 
 * This module provides resources that give AI agents access to contextual
 * information about Adobe Premiere Pro projects, sequences, and media.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PremiereProTransport } from '../bridge/types.js';
import { Logger } from '../utils/logger.js';
import {
  LIBRARY_ENTRY_URI_PREFIX,
  listEntries,
  readEntry,
  toIndexRow
} from '../library/index.js';

export const KNOWLEDGE_FILE_URI_PREFIX = 'buildx://knowledge/file/';
export const PRIVATE_KNOWLEDGE_URI_PREFIX = 'buildx://private/knowledge/';

/**
 * Resolves a path from a knowledge URI inside its base dir. Plain Markdown/JSON only,
 * and nothing that climbs out of the base — the private dir sits next to it.
 */
export function resolveKnowledgePath(baseDir: string, relative: string): string {
  const rel = decodeURIComponent(relative);
  if (!/\.(md|json)$/i.test(rel)) throw new Error(`Knowledge files are .md or .json, got '${rel}'`);
  const base = path.resolve(baseDir);
  const full = path.resolve(base, rel);
  if (path.isAbsolute(rel) || !full.startsWith(base + path.sep)) {
    throw new Error(`'${rel}' is outside ${base}`);
  }
  return full;
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * Where the BuildX library lives. Both are resolved by the caller (src/index.ts)
 * so this module never touches import.meta. Omitted = library resources report
 * that they are not configured instead of guessing a path.
 */
export interface ResourceDirs {
  /** $BUILDX_PRIVATE_DIR, or <repo>/private. Gitignored. */
  privateDir?: string;
  /** <repo>/knowledge — the tracked schema lives here. */
  knowledgeDir?: string;
}

export class PremiereProResources {
  private bridge: PremiereProTransport;
  private logger: Logger;
  private dirs: ResourceDirs;

  constructor(bridge: PremiereProTransport, dirs: ResourceDirs = {}) {
    this.bridge = bridge;
    this.logger = new Logger('PremiereProResources');
    this.dirs = dirs;
  }

  getAvailableResources(): MCPResource[] {
    return [
      {
        uri: 'premiere://project/info',
        name: 'Current Project Information',
        description: 'Information about the currently open Premiere Pro project',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://project/sequences',
        name: 'Project Sequences',
        description: 'List of all sequences in the current project',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://project/media',
        name: 'Project Media',
        description: 'List of all media items in the current project',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://project/bins',
        name: 'Project Bins',
        description: 'Organizational structure of bins in the current project',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://timeline/clips',
        name: 'Timeline Clips',
        description: 'All clips currently on the timeline',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://timeline/tracks',
        name: 'Timeline Tracks',
        description: 'Information about video and audio tracks',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://timeline/markers',
        name: 'Timeline Markers',
        description: 'Markers and their positions on the timeline',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://effects/available',
        name: 'Available Effects',
        description: 'List of all available effects in Premiere Pro',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://effects/applied',
        name: 'Applied Effects',
        description: 'Effects currently applied to clips',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://transitions/available',
        name: 'Available Transitions',
        description: 'List of all available transitions in Premiere Pro',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://export/presets',
        name: 'Export Presets',
        description: 'Available export presets and their settings',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://project/metadata',
        name: 'Project Metadata',
        description: 'Metadata information for the current project',
        mimeType: 'application/json'
      },
      {
        uri: 'premiere://config/get_instructions',
        name: 'Premiere Operating Instructions',
        description: 'Attach this before editing to give the model workflow and safety guidance for using the Premiere MCP server',
        mimeType: 'text/plain'
      },
      {
        uri: 'buildx://knowledge/index',
        name: 'BuildX Knowledge Index',
        description: `Read this first: every knowledge file the MCP can read, what it covers, when to use it, and its URI. Open a tracked file with ${KNOWLEDGE_FILE_URI_PREFIX}<path> and a private one with ${PRIVATE_KNOWLEDGE_URI_PREFIX}<path>.`,
        mimeType: 'text/markdown'
      },
      {
        uri: 'buildx://library/index',
        name: 'BuildX Video Library Index',
        description: `One compact row per past video (title, hook line, length, publish date, 30-day views, stayed-to-watch). Open a single video with ${LIBRARY_ENTRY_URI_PREFIX}<slug>. Reads $BUILDX_PRIVATE_DIR/library/entries.`,
        mimeType: 'application/json'
      },
      {
        uri: 'buildx://library/schema',
        name: 'BuildX Video Library Entry Schema',
        description: 'JSON Schema for one library entry — the fields every past video records.',
        mimeType: 'application/schema+json'
      }
    ];
  }

  async readResource(uri: string): Promise<any> {
    this.logger.info(`Reading resource: ${uri}`);
    
    switch (uri) {
      case 'premiere://project/info':
        return await this.getProjectInfo();
      
      case 'premiere://project/sequences':
        return await this.getProjectSequences();
      
      case 'premiere://project/media':
        return await this.getProjectMedia();
      
      case 'premiere://project/bins':
        return await this.getProjectBins();
      
      case 'premiere://timeline/clips':
        return await this.getTimelineClips();
      
      case 'premiere://timeline/tracks':
        return await this.getTimelineTracks();
      
      case 'premiere://timeline/markers':
        return await this.getTimelineMarkers();
      
      case 'premiere://effects/available':
        return await this.getAvailableEffects();
      
      case 'premiere://effects/applied':
        return await this.getAppliedEffects();
      
      case 'premiere://transitions/available':
        return await this.getAvailableTransitions();
      
      case 'premiere://export/presets':
        return await this.getExportPresets();
      
      case 'premiere://project/metadata':
        return await this.getProjectMetadata();

      case 'premiere://config/get_instructions':
        return this.getInstructions();

      case 'buildx://knowledge/index':
        return await readFile(resolveKnowledgePath(this.requireKnowledgeDir(), 'INDEX.md'), 'utf8');

      case 'buildx://library/index':
        return await this.getLibraryIndex();

      case 'buildx://library/schema':
        return await this.getLibrarySchema();

      default:
        if (uri.startsWith(LIBRARY_ENTRY_URI_PREFIX)) {
          return await readEntry(this.requirePrivateDir(), uri.slice(LIBRARY_ENTRY_URI_PREFIX.length));
        }
        if (uri.startsWith(KNOWLEDGE_FILE_URI_PREFIX)) {
          const rel = uri.slice(KNOWLEDGE_FILE_URI_PREFIX.length);
          return await readFile(resolveKnowledgePath(this.requireKnowledgeDir(), rel), 'utf8');
        }
        if (uri.startsWith(PRIVATE_KNOWLEDGE_URI_PREFIX)) {
          const rel = uri.slice(PRIVATE_KNOWLEDGE_URI_PREFIX.length);
          const base = path.join(this.requirePrivateDir(), 'knowledge');
          try {
            return await readFile(resolveKnowledgePath(base, rel), 'utf8');
          } catch (error: any) {
            if (error?.code === 'ENOENT') {
              throw new Error(`Private knowledge file '${rel}' is not on this machine (looked in ${base}; set BUILDX_PRIVATE_DIR).`);
            }
            throw error;
          }
        }
        throw new Error(`Resource '${uri}' not found`);
    }
  }

  getResource(uri: string): MCPResource | undefined {
    const listed = this.getAvailableResources().find((resource) => resource.uri === uri);
    if (listed) return listed;
    // One entry per past video, so entries are addressed by prefix rather than listed.
    if (uri.startsWith(LIBRARY_ENTRY_URI_PREFIX) && uri.length > LIBRARY_ENTRY_URI_PREFIX.length) {
      return {
        uri,
        name: `BuildX Video Library Entry ${uri.slice(LIBRARY_ENTRY_URI_PREFIX.length)}`,
        description: 'One past video: hook, transcript path, length, cuts, graphics, captions, links and performance.',
        mimeType: 'application/json'
      };
    }
    // Knowledge files are listed in buildx://knowledge/index, not here, so the resource
    // list stays short and the model reads the index before opening anything.
    for (const prefix of [KNOWLEDGE_FILE_URI_PREFIX, PRIVATE_KNOWLEDGE_URI_PREFIX]) {
      if (uri.startsWith(prefix) && uri.length > prefix.length) {
        const rel = uri.slice(prefix.length);
        return {
          uri,
          name: `BuildX Knowledge ${rel}`,
          description: 'A knowledge file listed in buildx://knowledge/index.',
          mimeType: rel.endsWith('.json') ? 'application/json' : 'text/markdown'
        };
      }
    }
    return undefined;
  }

  private requirePrivateDir(): string {
    if (!this.dirs.privateDir) {
      throw new Error('BuildX private dir is not configured — set BUILDX_PRIVATE_DIR on the MCP server.');
    }
    return this.dirs.privateDir;
  }

  private requireKnowledgeDir(): string {
    if (!this.dirs.knowledgeDir) {
      throw new Error('Knowledge dir is not configured on the MCP server.');
    }
    return this.dirs.knowledgeDir;
  }

  private async getLibraryIndex(): Promise<any> {
    const privateDir = this.requirePrivateDir();
    const { entries, skipped } = await listEntries(privateDir);
    return {
      privateDir,
      count: entries.length,
      entries: entries.map(toIndexRow),
      skipped
    };
  }

  private async getLibrarySchema(): Promise<string> {
    if (!this.dirs.knowledgeDir) {
      throw new Error('Knowledge dir is not configured on the MCP server.');
    }
    return await readFile(path.join(this.dirs.knowledgeDir, 'library', 'video-entry.schema.json'), 'utf8');
  }

  private async getProjectInfo(): Promise<any> {
    const script = `
      var project = app.project;
      JSON.stringify({
        id: project.documentID,
        name: project.name,
        path: project.path,
        isModified: project.dirty,
        settings: {
          scratchDiskPath: project.scratchDiskPath,
          captureFormat: project.captureFormat,
          previewFormat: project.previewFormat
        },
        statistics: {
          sequenceCount: project.sequences.numSequences,
          projectItemCount: project.rootItem.children.numItems
        }
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getProjectSequences(): Promise<any> {
    const script = `
      var project = app.project;
      var sequences = [];
      
      for (var i = 0; i < project.sequences.numSequences; i++) {
        var sequence = project.sequences[i];
        sequences.push({
          id: sequence.sequenceID,
          name: sequence.name,
          frameRate: sequence.framerate,
          duration: sequence.end - sequence.zeroPoint,
          videoTracks: sequence.videoTracks.numTracks,
          audioTracks: sequence.audioTracks.numTracks,
          settings: {
            frameSize: {
              width: sequence.frameSizeHorizontal,
              height: sequence.frameSizeVertical
            },
            pixelAspectRatio: sequence.pixelAspectRatio,
            fieldType: sequence.fieldType
          }
        });
      }
      
      JSON.stringify({
        sequences: sequences,
        totalCount: project.sequences.numSequences
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getProjectMedia(): Promise<any> {
    const script = `
      var project = app.project;
      var mediaItems = [];
      
      function traverseProjectItems(item) {
        for (var i = 0; i < item.children.numItems; i++) {
          var child = item.children[i];
          if (child.type === ProjectItemType.CLIP) {
            mediaItems.push({
              id: child.nodeId,
              name: child.name,
              type: child.type,
              mediaPath: child.getMediaPath(),
              duration: child.getOutPoint() - child.getInPoint(),
              frameRate: child.getVideoFrameRate(),
              hasVideo: child.hasVideo(),
              hasAudio: child.hasAudio(),
              metadata: {
                creationTime: child.getCreationTime(),
                modificationTime: child.getModificationTime(),
                fileSize: child.getFileSize()
              }
            });
          } else if (child.type === ProjectItemType.BIN) {
            traverseProjectItems(child);
          }
        }
      }
      
      traverseProjectItems(project.rootItem);
      
      JSON.stringify({
        mediaItems: mediaItems,
        totalCount: mediaItems.length
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getProjectBins(): Promise<any> {
    const script = `
      var project = app.project;
      var bins = [];
      
      function traverseBins(item, depth = 0) {
        for (var i = 0; i < item.children.numItems; i++) {
          var child = item.children[i];
          if (child.type === ProjectItemType.BIN) {
            bins.push({
              id: child.nodeId,
              name: child.name,
              depth: depth,
              itemCount: child.children.numItems,
              path: child.treePath
            });
            traverseBins(child, depth + 1);
          }
        }
      }
      
      traverseBins(project.rootItem);
      
      JSON.stringify({
        bins: bins,
        totalCount: bins.length
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getTimelineClips(): Promise<any> {
    const script = `
      var project = app.project;
      var clips = [];
      
      if (project.activeSequence) {
        var sequence = project.activeSequence;
        
        // Video tracks
        for (var v = 0; v < sequence.videoTracks.numTracks; v++) {
          var track = sequence.videoTracks[v];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            clips.push({
              id: clip.nodeId,
              name: clip.name,
              trackType: 'video',
              trackIndex: v,
              startTime: clip.start,
              endTime: clip.end,
              duration: clip.duration,
              inPoint: clip.inPoint,
              outPoint: clip.outPoint,
              mediaPath: clip.projectItem ? clip.projectItem.getMediaPath() : null,
              effects: clip.components.numItems
            });
          }
        }
        
        // Audio tracks
        for (var a = 0; a < sequence.audioTracks.numTracks; a++) {
          var track = sequence.audioTracks[a];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            clips.push({
              id: clip.nodeId,
              name: clip.name,
              trackType: 'audio',
              trackIndex: a,
              startTime: clip.start,
              endTime: clip.end,
              duration: clip.duration,
              inPoint: clip.inPoint,
              outPoint: clip.outPoint,
              mediaPath: clip.projectItem ? clip.projectItem.getMediaPath() : null,
              effects: clip.components.numItems
            });
          }
        }
      }
      
      JSON.stringify({
        clips: clips,
        totalCount: clips.length,
        activeSequence: project.activeSequence ? project.activeSequence.name : null
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getTimelineTracks(): Promise<any> {
    const script = `
      var project = app.project;
      var tracks = [];
      
      if (project.activeSequence) {
        var sequence = project.activeSequence;
        
        // Video tracks
        for (var v = 0; v < sequence.videoTracks.numTracks; v++) {
          var track = sequence.videoTracks[v];
          tracks.push({
            id: track.id,
            name: track.name,
            type: 'video',
            index: v,
            enabled: track.enabled,
            locked: track.locked,
            muted: track.muted,
            clipCount: track.clips.numItems,
            transitionCount: track.transitions.numItems
          });
        }
        
        // Audio tracks
        for (var a = 0; a < sequence.audioTracks.numTracks; a++) {
          var track = sequence.audioTracks[a];
          tracks.push({
            id: track.id,
            name: track.name,
            type: 'audio',
            index: a,
            enabled: track.enabled,
            locked: track.locked,
            muted: track.muted,
            clipCount: track.clips.numItems,
            transitionCount: track.transitions.numItems
          });
        }
      }
      
      JSON.stringify({
        tracks: tracks,
        totalCount: tracks.length,
        activeSequence: project.activeSequence ? project.activeSequence.name : null
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getTimelineMarkers(): Promise<any> {
    const script = `
      var project = app.project;
      var markers = [];
      
      if (project.activeSequence) {
        var sequence = project.activeSequence;
        
        for (var i = 0; i < sequence.markers.numMarkers; i++) {
          var marker = sequence.markers[i];
          markers.push({
            id: marker.guid,
            name: marker.name,
            comment: marker.comment,
            startTime: marker.start,
            endTime: marker.end,
            duration: marker.duration,
            type: marker.type,
            color: marker.color
          });
        }
      }
      
      JSON.stringify({
        markers: markers,
        totalCount: markers.length,
        activeSequence: project.activeSequence ? project.activeSequence.name : null
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getAvailableEffects(): Promise<any> {
    const script = `
      var effects = [];
      
      // Get video effects
      var videoEffects = app.getAvailableVideoEffects();
      for (var i = 0; i < videoEffects.length; i++) {
        effects.push({
          name: videoEffects[i].name,
          matchName: videoEffects[i].matchName,
          category: videoEffects[i].category,
          type: 'video'
        });
      }
      
      // Get audio effects
      var audioEffects = app.getAvailableAudioEffects();
      for (var i = 0; i < audioEffects.length; i++) {
        effects.push({
          name: audioEffects[i].name,
          matchName: audioEffects[i].matchName,
          category: audioEffects[i].category,
          type: 'audio'
        });
      }
      
      JSON.stringify({
        effects: effects,
        totalCount: effects.length
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getAppliedEffects(): Promise<any> {
    const script = `
      var project = app.project;
      var appliedEffects = [];
      
      if (project.activeSequence) {
        var sequence = project.activeSequence;
        
        // Check video tracks
        for (var v = 0; v < sequence.videoTracks.numTracks; v++) {
          var track = sequence.videoTracks[v];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            for (var e = 0; e < clip.components.numItems; e++) {
              var effect = clip.components[e];
              appliedEffects.push({
                clipId: clip.nodeId,
                clipName: clip.name,
                effectName: effect.displayName,
                effectMatchName: effect.matchName,
                trackType: 'video',
                trackIndex: v,
                enabled: effect.enabled
              });
            }
          }
        }
        
        // Check audio tracks
        for (var a = 0; a < sequence.audioTracks.numTracks; a++) {
          var track = sequence.audioTracks[a];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            for (var e = 0; e < clip.components.numItems; e++) {
              var effect = clip.components[e];
              appliedEffects.push({
                clipId: clip.nodeId,
                clipName: clip.name,
                effectName: effect.displayName,
                effectMatchName: effect.matchName,
                trackType: 'audio',
                trackIndex: a,
                enabled: effect.enabled
              });
            }
          }
        }
      }
      
      JSON.stringify({
        appliedEffects: appliedEffects,
        totalCount: appliedEffects.length
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getAvailableTransitions(): Promise<any> {
    const script = `
      var transitions = [];
      
      // Get video transitions
      var videoTransitions = app.getAvailableVideoTransitions();
      for (var i = 0; i < videoTransitions.length; i++) {
        transitions.push({
          name: videoTransitions[i].name,
          matchName: videoTransitions[i].matchName,
          category: videoTransitions[i].category,
          type: 'video'
        });
      }
      
      // Get audio transitions
      var audioTransitions = app.getAvailableAudioTransitions();
      for (var i = 0; i < audioTransitions.length; i++) {
        transitions.push({
          name: audioTransitions[i].name,
          matchName: audioTransitions[i].matchName,
          category: audioTransitions[i].category,
          type: 'audio'
        });
      }
      
      JSON.stringify({
        transitions: transitions,
        totalCount: transitions.length
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getExportPresets(): Promise<any> {
    const script = `
      var presets = [];
      var encoder = app.encoder;
      
      // Get available export presets
      var exportPresets = encoder.getExportPresets();
      for (var i = 0; i < exportPresets.length; i++) {
        presets.push({
          name: exportPresets[i].name,
          matchName: exportPresets[i].matchName,
          category: exportPresets[i].category,
          description: exportPresets[i].description,
          fileExtension: exportPresets[i].fileExtension
        });
      }
      
      JSON.stringify({
        presets: presets,
        totalCount: presets.length
      });
    `;
    
    return await this.bridge.executeScript(script);
  }

  private async getProjectMetadata(): Promise<any> {
    const script = `
      var project = app.project;
      var metadata = {};
      
      if (project.activeSequence) {
        var sequence = project.activeSequence;
        
        metadata = {
          project: {
            name: project.name,
            path: project.path,
            creationTime: project.creationTime,
            modificationTime: project.modificationTime
          },
          sequence: {
            name: sequence.name,
            duration: sequence.end - sequence.zeroPoint,
            frameRate: sequence.framerate,
            settings: {
              frameSize: {
                width: sequence.frameSizeHorizontal,
                height: sequence.frameSizeVertical
              },
              pixelAspectRatio: sequence.pixelAspectRatio,
              fieldType: sequence.fieldType
            }
          },
          statistics: {
            totalClips: 0,
            totalEffects: 0,
            totalTransitions: 0
          }
        };
        
        // Count clips, effects, and transitions
        for (var v = 0; v < sequence.videoTracks.numTracks; v++) {
          var track = sequence.videoTracks[v];
          metadata.statistics.totalClips += track.clips.numItems;
          metadata.statistics.totalTransitions += track.transitions.numItems;
          
          for (var c = 0; c < track.clips.numItems; c++) {
            metadata.statistics.totalEffects += track.clips[c].components.numItems;
          }
        }
        
        for (var a = 0; a < sequence.audioTracks.numTracks; a++) {
          var track = sequence.audioTracks[a];
          metadata.statistics.totalClips += track.clips.numItems;
          metadata.statistics.totalTransitions += track.transitions.numItems;
          
          for (var c = 0; c < track.clips.numItems; c++) {
            metadata.statistics.totalEffects += track.clips[c].components.numItems;
          }
        }
      }
      
      JSON.stringify(metadata);
    `;
    
    return await this.bridge.executeScript(script);
  }

  private getInstructions(): string {
    return [
      'You are controlling Adobe Premiere Pro through the MCP server in this workspace.',
      '',
      'Operating rules:',
      '1. Inspect the project before editing. Start with list_sequences, list_sequence_tracks, list_project_items, or the premiere://project/* resources unless the user already gave exact IDs.',
      '2. Prefer non-destructive operations first. Duplicate sequences before risky changes when the user is exploring or when the request is ambiguous.',
      '3. When building edits, add clips first, then trims and timing changes, then transitions and effects, then export.',
      '4. For branded or ad-style assemblies, prefer assemble_product_spot or build_brand_spot_from_mogrt_and_assets with clipPlan rather than relying on fixed defaults.',
      '5. Use real MOGRTs, footage, LUTs, and audio when the user wants polished output. The server can automate assembly, but it does not invent final-quality design assets.',
      '6. For cuts across many layers, prefer razor_timeline_at_time instead of splitting each clip one by one.',
      '7. Keep transitions short unless the user asks otherwise. Cross dissolves usually work best when clips are adjacent and on the same track.',
      '8. Verify the active sequence before timeline operations. If needed, call set_active_sequence first.',
      '9. If a tool fails, report the real limitation instead of pretending success. Premiere scripting coverage is incomplete in some areas.',
      '10. The CEP bridge panel must be open, pointed at /tmp/premiere-mcp-bridge, and started, or tool calls may time out.',
      '',
      'Suggested discovery flow:',
      '- Read premiere://config/get_instructions',
      '- Read premiere://project/info',
      '- Read premiere://project/sequences',
      '- Read premiere://timeline/tracks when editing an existing sequence',
      '',
      'Suggested editing flow:',
      '- set_active_sequence if needed',
      '- import_media / import_folder / create_bin',
      '- add_to_timeline / razor_timeline_at_time / trim_clip / move_clip',
      '- add_transition / add_transition_to_clip / apply_effect / color_correct / apply_lut',
      '- export_sequence / export_frame / export_as_fcp_xml',
      '',
      'Be explicit with sequence IDs, clip IDs, track indices, file paths, and durations when the user gives them.'
    ].join('\n');
  }
}
