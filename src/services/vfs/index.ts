/**
 * VFS Public API — barrel export for the Virtual File System module.
 *
 * All consumers should import from this module:
 *   import { VfsRegistry, VfsInstance, ... } from "@/services/vfs";
 *
 * This re-exports:
 *   - VfsRegistry:  singleton for managing VfsInstance lifecycle
 *   - VfsInstance:   the per-tab VFS class (for type references)
 *   - Types:         NodeFilesEntry, VfsSnapshot, VfsFileQuery
 *   - Orchestrators: executionOrchestrator, persistenceOrchestrator, queryOrchestrator
 *   - Lifecycle:     setExecutingNode (global, non-tab-scoped utility)
 */

// Contract layer
export { VfsRegistry } from "./VfsRegistry";
export { VfsInstance, VFS_CHANGED_EVENT } from "./VfsInstance";
export type { VfsChangedDetail } from "./VfsInstance";

// Types
export type { NodeFilesEntry, VfsSnapshot, VfsFileQuery } from "./types";

// Orchestrators
export * as executionOrchestrator from "./orchestrators/executionOrchestrator";
export * as persistenceOrchestrator from "./orchestrators/persistenceOrchestrator";
export * as queryOrchestrator from "./orchestrators/queryOrchestrator";

// Global lifecycle utility (non-tab-scoped)
export { setExecutingNode } from "./actions/lifecycleActions";
