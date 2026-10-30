// ============================================================
// catalog.ts -- the token optimisations, as the Settings page and the
// README describe them. Each has an id (what switches and code refer to),
// a name, one plain sentence of what it does, a few sentences of what it
// keeps and what it costs, and where it acts. The safeguards are listed
// apart: they have no switch, because they are what makes the
// optimisations safe to leave on.
// ============================================================

export type OptimizationId = "command-output" | "recall" | "repeat-results" | "tool-output-limits" | "stable-history" | "warm-cache-guard";

export interface TokenOptimization {
  id: OptimizationId;
  name: string;
  summary: string;
  details: string;
  /** The tools or steps it changes. */
  actsOn: string;
  defaultEnabled: boolean;
}

export const TOKEN_OPTIMIZATIONS: readonly TokenOptimization[] = [
  {
    id: "command-output",
    name: "Condense command output",
    summary: "Removes progress bars, passing tests, download logs and other noise from command output before the model reads it.",
    details:
      "Applied once, when the command finishes, so the saving repeats on every later turn without disturbing the prompt cache. Errors, failing tests, summaries and what the command changed are kept, and the result keeps the tool's own format. Very long output keeps its first 50 and last 200 lines, because errors are at the end. Identical lines in a row are counted, never reordered.",
    actsOn: "run_command, run_check and install_dependencies output, job_output progress",
    defaultEnabled: true,
  },
  {
    id: "recall",
    name: "Keep full output recallable",
    summary: "Keeps the full output of every condensed command, so the model can read what was left out instead of running the command again.",
    details:
      "A condensed result ends with a stamp naming an id such as out-3f9c2a81d4e70b5a; job_output reads it whole, by line range or by pattern. The id is a hash of the output, so the same output always has the same id. Outputs stay in memory until Rusty quits (the last 30). How often each filter's output is read back is shown below: a high rate means that filter leaves out too much.",
    actsOn: "job_output",
    defaultEnabled: true,
  },
  {
    id: "repeat-results",
    name: "Don't resend what the agent already has",
    summary: "When a tool would give an agent exactly what it already received in this session (the same file read, the same spec document), it gets a one-line pointer instead.",
    details:
      "Agents re-read the files they work on and ask for the spec and design again and again; each copy is paid for on every later request. Only identical content counts: a file that changed since, or other lines of it, come back in full. The pointer names an id, so the full text is one job_output call away if the earlier copy was shortened. A workflow step or sub-agent has its own conversation and gets everything once.",
    actsOn: "read_file, spec_context documents, repo_context, project_info, code_guidelines, search_codebase and the other repo_ tools",
    defaultEnabled: true,
  },
  {
    id: "tool-output-limits",
    name: "Limit very large tool reports",
    summary: "Cuts a reporting tool's result over 12,000 characters to its beginning and end, keeping the full text recallable.",
    details:
      "Repository context, project information, guidelines and search reports can run to tens of thousands of characters, most of it never used. The first 9,000 and last 2,000 characters are kept, with a stamp naming a job_output id for the rest. Files (read_file) and spec documents are never cut.",
    actsOn: "repo_context, project_info, code_guidelines, search_codebase, list_files and the repo_ tools",
    defaultEnabled: true,
  },
  {
    id: "stable-history",
    name: "Cache-friendly chat history",
    summary: "When a long chat must leave out its oldest messages, moves that cut in steps instead of on every turn, so the provider's prompt cache keeps matching.",
    details:
      "Providers bill a cached prompt prefix at a fraction of the normal price, but only while the prefix stays identical. Re-trimming the history on every turn changes it every turn. With this on, the cut moves only after about a quarter of the history budget has been added, and between moves every request starts the same way. It may leave out a few more old messages than strictly needed. Pinned messages and the opening request are always kept.",
    actsOn: "earlier chat turns sent with each request",
    defaultEnabled: true,
  },
  {
    id: "warm-cache-guard",
    name: "Keep the model on a warm cache",
    summary: "Never moves a conversation that is already cached to a cheaper model mid-run, because the whole cached conversation would be paid again at full price.",
    details:
      "A cache belongs to one model. Mid-run, a switch is allowed only to a more capable model (AUTO's step-up), where a better answer is worth paying for the conversation once more; the log says so when it happens. Choosing a model at the start of a workflow step is not affected, since nothing is cached yet.",
    actsOn: "AUTO model choice per workflow step and mid-run step-up",
    defaultEnabled: true,
  },
];

export interface Safeguard {
  name: string;
  summary: string;
}

export const SAFEGUARDS: readonly Safeguard[] = [
  { name: "Never worse", summary: "An optimisation that would not make the text smaller is not applied; the original is sent instead." },
  { name: "Fail open", summary: "An optimisation that fails is skipped and the original is sent unchanged; saving tokens never stops a command or a model turn." },
  { name: "Stamps", summary: "Condensed text carries a one-line stamp, so no later pass condenses it again and in-run compaction keeps the way back to the full output." },
];

export const optimizationById = (id: OptimizationId): TokenOptimization => TOKEN_OPTIMIZATIONS.find((optimization) => optimization.id === id)!;
