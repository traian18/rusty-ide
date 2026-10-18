// definitions/singleAgentProfile.ts — the behavior profile the Agent tab's
// single agent runs under when the workspace names no default of its own.
//
// Its one job is the completion gate: when the model proposes a final answer,
// rusty-core calls `update_todos` with no arguments, which fails while the
// chat's task list has items pending or in progress. The failure is sent back
// and the loop continues, at most `max_continuations` times; after that the
// check is waived so a stuck run still ends. A session where the check cannot
// run (a spawned child without `update_todos`) passes.
//
// The document is JSON so src-tauri's tests can validate it against
// rusty-core. Published revisions are immutable: bump `revision` when it
// changes.

import profile from "./singleAgentProfile.json";

export const SINGLE_AGENT_PROFILE: Record<string, unknown> = profile;
