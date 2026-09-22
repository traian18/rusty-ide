// ============================================================
// capabilities.ts — The single capability registry.
//
// CapabilityMap is the one place a capability's input/event/result shapes
// are declared. Adding a capability means adding an entry here (plus a
// backend definition/binding); nothing else in src/harness/ hardcodes the
// list of nine names.
//
// CapabilityName is asserted (capabilityParity.test.ts) to match
// AGENT_CAPABILITIES in shared/agent-protocol/capabilities.ts -- that file
// remains the sidecar's own wire vocabulary; this one is the IDE's backend-
// agnostic contract. They describe the same nine capabilities today, but
// this map does not import from shared/agent-protocol so the contract
// never depends on the sidecar's wire shapes.
// ============================================================

import type {
  CommonEvent,
  FileCompleteEvent,
  FileErrorEvent,
  IterationEvent,
  NodeStatusChangeEvent,
} from "./events";

/** inline_chat's own chat-turn shape (mirrors InlineChatEditorContext's
 * neighbor, InlineChatMessage, in the file it's migrated from). The other
 * capabilities' chatHistory stays `unknown[]` here, matching what the
 * sidecar's wire commands accept today (shared/agent-protocol/commands.ts) --
 * they pass through src/store/types.ts's AgentMessage[] unvalidated at the
 * call site, and tightening that is out of scope for this migration. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EditorSelectionContext {
  filePath: string;
  language: string;
  fileContent: string;
  selection: {
    text: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

// --- per-capability input ---------------------------------------------

export interface InlineChatInput {
  sessionId: string;
  message: string;
  model: string;
  workspaceRoot: string;
  customProvider: unknown;
  history: ChatMessage[];
  context: EditorSelectionContext;
}

export interface AgentChatInput {
  tabId: string;
  message: string;
  workspaceRoot: string;
  model: string;
  chatHistory: unknown[];
  mcpServers: unknown[];
  customProvider: unknown;
  skill: unknown;
  planOnly: boolean;
  vfsOnly: boolean;
  lspSettings: unknown;
  /** Web-search provider API keys (store.webSearchApiKeys), threaded in by
   * the call site rather than read from the store directly inside
   * definitions/agent_chat.ts -- that file importing "../../../store"
   * created a real circular import (store.ts's own slice composition
   * transitively reaches every capability definition), so this follows
   * the same call-site-resolves-store-state pattern mcpServers/
   * customProvider already use. Optional so every existing call site
   * (and every fixture in this codebase's tests) keeps compiling. */
  webSearchApiKeys?: Record<string, string>;
}

export interface ExecuteNodeInput {
  nodeId: string;
  instructions: string;
  model: string;
  workspaceRoot: string;
  inputFiles: unknown[];
  customProvider: unknown;
  globalContext: string;
  contextDescriptions: unknown;
  chatHistory: unknown[];
  skill: unknown;
  mcpContext: unknown[];
  upstreamTaskContext: unknown[];
  lspSettings: unknown;
}

export interface GlobalExploreInput {
  nodeId: string;
  prompt: string;
  workspaceRoot: string;
  model: string;
  chatHistory: unknown[];
  customProvider: unknown;
  skill?: unknown;
  mcpServers?: unknown[];
  planOnly?: boolean;
}

export interface GenerateTaskNodesInput {
  requestId: string;
  nodeId: string;
  model: string;
  customProvider: unknown;
  chatHistory?: unknown[];
  additionalInstructions?: string;
  workspaceRoot: string;
}

export interface GenerateSkillInput {
  description: string;
  model: string;
  customProvider: unknown;
  workspaceRoot?: string;
}

export interface ReconciliateEdgeInput {
  edgeId: string;
  // Optional in practice: the caller passes sourceNode?.id/targetNode?.id,
  // which can be undefined even though the sidecar's wire command
  // documents both as required.
  sourceTaskId: string | undefined;
  targetTaskId: string | undefined;
  modifiedFiles: unknown[];
  workspaceRoot: string;
  model: string;
  userMessage?: string;
  chatHistory?: unknown[];
  sourcePrompt?: string;
  targetPrompt?: string;
  customProvider: unknown;
}

export interface ReconciliateGraphInput {
  tabId: string;
  model: string;
  nodes: unknown[];
  workspaceRoot: string;
  customProvider: unknown;
  duplicateFiles?: Record<string, string[]>;
  fileSources?: Record<string, string>;
  chatHistory?: unknown[];
  userMessage?: string;
}

export interface TestBuildInput {
  tabId: string;
  buildCommand: string;
  workspaceRoot: string;
  reconciledFiles: unknown[];
  model: string;
  customProvider: unknown;
}

// --- the registry -------------------------------------------------------

export interface CapabilityMap {
  inline_chat: {
    input: InlineChatInput;
    event: CommonEvent;
    result: { response: string };
  };
  agent_chat: {
    input: AgentChatInput;
    event: CommonEvent;
    result: { response: string; modifiedFiles: string[]; subagents: unknown[] };
  };
  execute_node: {
    input: ExecuteNodeInput;
    event: CommonEvent | NodeStatusChangeEvent;
    // The wire event's `result` also carries a `status` field
    // (agent-sidecar/src/capabilities/executeNode.ts), but no consumer
    // (agentRunCoordinator.ts) ever reads it -- dropped here rather than
    // carried through unused.
    result: { modified: string[]; response: string };
  };
  global_explore: {
    input: GlobalExploreInput;
    event: CommonEvent;
    result: { response: string; summary?: string };
  };
  generate_task_nodes: {
    input: GenerateTaskNodesInput;
    event: CommonEvent;
    result: { tasks: unknown[]; contexts: unknown[]; attempts: number };
  };
  generate_skill: {
    input: GenerateSkillInput;
    event: CommonEvent;
    result: { spec: unknown };
  };
  reconciliate_edge: {
    input: ReconciliateEdgeInput;
    event: CommonEvent;
    result: { response: string };
  };
  reconciliate_graph: {
    input: ReconciliateGraphInput;
    event: CommonEvent | FileCompleteEvent | FileErrorEvent;
    result: { response: string; reviewedFiles: unknown[]; reconciledFiles: string[]; modifiedFiles: string[] };
  };
  test_build: {
    input: TestBuildInput;
    event: CommonEvent | IterationEvent;
    result: { success: boolean; attempts: number; finalFiles: Record<string, string> };
  };
}

export type CapabilityName = keyof CapabilityMap;
export type CapabilityInput<K extends CapabilityName> = CapabilityMap[K]["input"];
export type CapabilityEvent<K extends CapabilityName> = CapabilityMap[K]["event"];
export type CapabilityResult<K extends CapabilityName> = CapabilityMap[K]["result"];

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  "inline_chat",
  "agent_chat",
  "execute_node",
  "global_explore",
  "generate_task_nodes",
  "generate_skill",
  "reconciliate_edge",
  "reconciliate_graph",
  "test_build",
] as const;
