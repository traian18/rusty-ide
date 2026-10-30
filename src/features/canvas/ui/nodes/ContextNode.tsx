/**
 * Barrel re-export — preserves the import path for consumers.
 *
 * Before: import { ContextNode } from "../../nodes/ContextNode";
 * After:  import { ContextNode } from "../../nodes/ContextNode";  (unchanged)
 *
 * The actual implementation lives in ./contextNode/ContextNode.tsx.
 */
export { ContextNode } from "./contextNode/ContextNode";
