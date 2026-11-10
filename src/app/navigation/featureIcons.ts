// Rusty's own icons for features that a stock icon described too vaguely. Built with lucide's
// createLucideIcon on its 24-unit grid, so they take the same props (size, strokeWidth,
// className) and stroke style as the lucide icons beside them.
import { createLucideIcon } from "lucide-react";

/** Architecture: modules above and below a shared layer, the way a codebase's layers stack. */
export const ArchitectureIcon = createLucideIcon("rusty-architecture", [
  ["rect", { x: "8", y: "2", width: "8", height: "5", rx: "1.5", key: "top" }],
  ["rect", { x: "3", y: "10", width: "18", height: "4", rx: "1.5", key: "layer" }],
  ["rect", { x: "3", y: "17", width: "7", height: "5", rx: "1.5", key: "left" }],
  ["rect", { x: "14", y: "17", width: "7", height: "5", rx: "1.5", key: "right" }],
  ["path", { d: "M12 7v3M6.5 14v3M17.5 14v3", key: "links" }],
]);

/** Workflows: a step, a gate that checks it, the next step, and the way back for another try. */
export const WorkflowsIcon = createLucideIcon("rusty-workflows", [
  ["rect", { x: "2", y: "3", width: "7", height: "6", rx: "1.5", key: "step" }],
  ["path", { d: "M9 6h3.5", key: "to-gate" }],
  ["path", { d: "M16 2.5l3.5 3.5L16 9.5 12.5 6Z", key: "gate" }],
  ["path", { d: "M16 9.5V14", key: "to-next" }],
  ["rect", { x: "12.5", y: "14", width: "7", height: "6", rx: "1.5", key: "next" }],
  ["path", { d: "M12.5 17H5.5V9", key: "back" }],
]);
