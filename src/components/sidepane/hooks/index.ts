/**
 * hooks/index.ts
 *
 * Barrel file for SidePane custom hooks.
 */

export { useSidePaneState } from "./useSidePaneState";
export type { SidePaneState } from "./useSidePaneState";
export { useNodeUsage } from "./useNodeUsage";
export type { TokenUsageLike } from "./useNodeUsage";
export { useVfsFileSync } from "./useVfsFileSync";
export { useWidthSync } from "./useWidthSync";
export { useEscapeClose } from "./useEscapeClose";
export { useActiveTabDefault } from "./useActiveTabDefault";
export type { SidePaneTab } from "./useActiveTabDefault";
export { useActiveDiffFile } from "./useActiveDiffFile";
