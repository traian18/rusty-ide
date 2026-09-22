/**
 * VFS Types — shared type definitions for the Virtual File System.
 *
 * All types consumed by the actions, contract, and orchestrator layers
 * are defined here to avoid circular dependencies and provide a single
 * source of truth.
 */

/** Response shape from the Rust tracker: which files belong to which node */
export interface NodeFilesEntry {
  node_id: string;
  files: string[];
}

/** Serializable snapshot of the full VFS state for persistence */
export interface VfsSnapshot {
  contents: Record<string, string>;     // path → file content
  tracker: Record<string, string[]>;    // nodeId → file paths
}

/** Query filters for file lookups */
export interface VfsFileQuery {
  /** Filter to files owned by this node */
  nodeId?: string;
  /** Filter to files under this directory prefix */
  pathPrefix?: string;
  /** Filter by regex on the file path */
  pathPattern?: RegExp;
  /** Filter by file extension (e.g. ".ts", ".tsx") */
  extension?: string;
}
