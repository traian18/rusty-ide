// The chat's message model, shared by the chat views, the Agent Tab and
// chat persistence.

export interface ActivityEntry {
  content: string;
  kind: "tool" | "update";
  /** When it was recorded (ms since epoch), so it can sit between the model's messages. */
  at?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool-result" | "console";
  content: string;
  activityEntries?: ActivityEntry[];
  timestamp: string;
  attachments?: { path: string; name: string; isDir?: boolean }[];
  pinned?: boolean;
  /** "response", "activity" or "query"; messages saved before phases existed have none. */
  phase?: string;
}

export interface SubagentActivity {
  id: string;
  previousId?: string;
  agentId?: string;
  displayName?: string;
  description: string;
  subagentType?: string;
  isAggregation?: boolean;
  status: "queued" | "running" | "background" | "completed" | "steered" | "aborted" | "stopped" | "error";
  activity?: string;
  result?: string;
  error?: string;
  outputFile?: string;
  toolUses?: number;
  tokens?: string;
  turnCount?: number;
  maxTurns?: number;
  durationMs?: number;
  appendLog?: string;
  logs?: string[];
  startedAt?: string;
  updatedAt?: string;
  parentAgentId?: string;
  scope?: string[];
  excludedScope?: string[];
  expectedOutput?: "findings" | "review" | "recommendation";
  evidenceRequired?: boolean;
  timeoutMs?: number;
  queuePosition?: number;
  incorporated?: boolean;
}

export interface ChatPerformanceMetrics {
  scrollEvents: number;
  visibilityScans: number;
  geometryReads: number;
  visibilityDurationMs: number;
  followLatestWrites: number;
  jumpLatencyMs?: number;
}
