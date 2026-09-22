// ============================================================
// host.ts — What a running capability may ask the IDE for.
//
// A RunHost is supplied by the caller (a component or coordinator) for
// each run and closes over whatever state that surface needs (VFS maps,
// canvas context, the current node id, ...) -- the harness backends
// (sidecar, core) never see that state directly, only the RunHost.
//
// Contract rules, enforced by testing/contractTests.ts:
//  - Paths are ABSOLUTE (the VFS/disk bridging that resolves them lives in
//    the caller's RunHost implementation, exactly as it does today in
//    agentRunCoordinator.ts / useExplorerWebSocket.ts).
//  - readFile/writeFile/writePlan are awaited IN ORDER by a harness's
//    dispatch loop before the next event is delivered -- reconciliate_graph's
//    per-file ledger depends on this.
//  - requestPermission/askQuestion are user-blocking and are NOT awaited by
//    the dispatch loop; the harness keeps delivering other events while one
//    is pending.
//  - Every method receives an AbortSignal that fires at the run's terminal
//    outcome or on cancel(); a settlement after abort is ignored by the
//    harness (never delivered to the backend).
//
// These types are the IDE's own vocabulary for permissions/questions --
// deliberately NOT imported from shared/agent-protocol (that package is the
// sidecar's wire format and is owned by src/harness/sidecar/ only, per
// contract/layering.test.ts). SidecarHarness maps between the two; today
// the fields are identical, so the mapping is a straight pass-through.
// ============================================================

export type CommandPermissionDecision = "deny" | "allow_once" | "allow_session";
export type CommandRisk = "normal" | "elevated" | "destructive";
export type CommandSessionGrantScope = "executable" | "exact_command";

export interface CommandPermissionRequest {
  requestId: string;
  sessionId: string;
  command: { program: string; args: string[]; cwd: string; timeoutMs: number };
  risk: CommandRisk;
  sessionGrantScope: CommandSessionGrantScope;
  sessionGrantProgram: string;
  description: string;
}

export interface AgentQuestion {
  requestId: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
}

export interface RunHost {
  readFile(path: string, signal: AbortSignal): Promise<string>;
  writeFile(path: string, content: string, signal: AbortSignal): Promise<void>;
  writePlan?(filename: string, content: string, signal: AbortSignal): Promise<string>;
  requestPermission(request: CommandPermissionRequest, signal: AbortSignal): Promise<CommandPermissionDecision>;
  askQuestion?(question: AgentQuestion, signal: AbortSignal): Promise<string>;
}
