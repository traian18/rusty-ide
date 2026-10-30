/**
 * Utility to stop React Flow from intercepting events on interactive controls
 * inside a draggable node. Must be applied to all buttons, inputs, and menus
 * within a node to prevent unwanted drag/select behavior.
 */

import type { SyntheticEvent } from "react";

/** Stops event propagation for both pointer and mouse events. */
export function stopNodePropagation<E extends SyntheticEvent>(e: E): void {
  e.stopPropagation();
}
