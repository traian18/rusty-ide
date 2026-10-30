/**
 * hooks/index.ts
 *
 * Barrel file for SidePane custom hooks.
 */

export { useSidePaneState } from "./useSidePaneState";
export type { SidePaneState } from "./useSidePaneState";
export { useNodeUsage } from "../../ui/sidepane/hooks/useNodeUsage";
export type { TokenUsageLike } from "../../ui/sidepane/hooks/useNodeUsage";
export { useVfsFileSync } from "../../ui/sidepane/hooks/useVfsFileSync";
export { useWidthSync } from "../../ui/sidepane/hooks/useWidthSync";
export { useEscapeClose } from "../../ui/sidepane/hooks/useEscapeClose";
export { useActiveTabDefault } from "../../ui/sidepane/hooks/useActiveTabDefault";
export type { SidePaneTab } from "../../ui/sidepane/hooks/useActiveTabDefault";
export { useActiveDiffFile } from "../../ui/sidepane/hooks/useActiveDiffFile";
