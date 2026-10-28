// definitions/singleAgentProfile.ts — the behavior profile the Agent tab's
// single agent runs under when the workspace names no default of its own.
//
// Its job is the completion gate. When the model proposes a final answer the
// guidelines check runs `code_guidelines {gate: true}`, which fails while the
// run's change introduced a guideline error (it passes when the project has
// none), and rusty-core calls `update_todos` with no arguments, which fails
// while the chat's task list has items pending or in progress. A failure is
// sent back and the loop continues, at most `max_continuations` times; after
// that the checks are waived so a stuck run still ends. A session where a
// check cannot run (a spawned child without the tool) passes.
//
// The document is JSON so src-tauri's tests can validate it against
// rusty-core. Published revisions are immutable: bump `revision` when it
// changes.

import profile from "./singleAgentProfile.json";

export const SINGLE_AGENT_PROFILE: Record<string, unknown> = profile;
