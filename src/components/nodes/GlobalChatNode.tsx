/**
 * Barrel re-export — preserves the import path for consumers.
 *
 * Before: import { GlobalChatNode } from "../../nodes/GlobalChatNode";
 * After:  import { GlobalChatNode } from "../../nodes/GlobalChatNode";  (unchanged)
 *
 * The actual implementation lives in ./globalChat/GlobalChatNode.tsx.
 */
export { GlobalChatNode } from "./globalChat/GlobalChatNode";
