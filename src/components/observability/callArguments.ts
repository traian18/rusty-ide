// What a tool call's arguments say about it, for its summary. Tools spell
// the same thing differently (`CommandLine`, `command`, `cmd`), so a new
// tool usually needs only its spelling added to ARGUMENT_NAMES, or one more
// reader in CALL_READERS -- not a change to how summaries are built.

export type ToolArguments = Record<string, unknown>;

export interface KeyParam {
  label: string;
  value: string;
}

/** A summary while the readers fill it in. */
export interface SummaryDraft {
  toolName: string;
  actionLabel: string;
  target?: string;
  keyParams: KeyParam[];
}

/** The argument names tools use for the same thing, in lookup order. */
export const ARGUMENT_NAMES = {
  action: ["toolAction"],
  summary: ["toolSummary"],
  description: ["Description", "description"],
  instruction: ["Instruction", "instruction"],
  command: ["CommandLine", "command", "cmd"],
  file: ["TargetFile", "AbsolutePath", "path", "filePath", "file_path"],
  query: ["Query", "query", "pattern"],
} as const;

const EDITING_TOOL_WORDS = ["replace", "edit", "write"];
const VIEWING_TOOL_WORDS = ["view", "read"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** The first of `names` holding a non-blank string, trimmed. */
export function firstTrimmed(args: ToolArguments, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = args[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** The first of `names` holding a non-empty string, as written. */
function firstNonEmpty(args: ToolArguments, names: readonly string[]): string | undefined {
  return names.map((name) => args[name]).find(isNonEmptyString);
}

function lastSegment(path: string): string {
  return path.split("/").pop() || path;
}

/** Whether no argument has named the action yet. */
function unlabelled(draft: SummaryDraft): boolean {
  return draft.actionLabel === draft.toolName;
}

export function truncateCommand(cmd: string): string {
  const trimmed = cmd.trim();
  if (trimmed.length <= 25) return trimmed;
  return `${trimmed.slice(0, 25)}...`;
}

function commandLine(args: ToolArguments): string | undefined {
  const command = firstTrimmed(args, ARGUMENT_NAMES.command);
  if (command) return command;
  const program = firstTrimmed(args, ["program"]);
  if (!program) return undefined;
  return Array.isArray(args.args) ? `${program} ${args.args.join(" ")}` : program;
}

function readCommand(args: ToolArguments, draft: SummaryDraft): void {
  const command = commandLine(args);
  if (!command) return;
  const display = truncateCommand(command);
  draft.target = display;
  draft.actionLabel = `Run: ${display}`;
  draft.keyParams.push({ label: "Command", value: display });
  if (typeof args.Cwd === "string") draft.keyParams.push({ label: "Directory", value: args.Cwd });
}

function fileAction(toolName: string, fileName: string): string {
  if (EDITING_TOOL_WORDS.some((word) => toolName.includes(word))) return `Edit: ${fileName}`;
  if (VIEWING_TOOL_WORDS.some((word) => toolName.includes(word))) return `View: ${fileName}`;
  return `${toolName} → ${fileName}`;
}

function lineRange(args: ToolArguments): string | undefined {
  if (args.StartLine === undefined && args.EndLine === undefined) return undefined;
  return `${args.StartLine ?? 1}–${args.EndLine ?? "end"}`;
}

function readFile(args: ToolArguments, draft: SummaryDraft): void {
  const filePath = firstNonEmpty(args, ARGUMENT_NAMES.file);
  if (!filePath) return;
  draft.target = filePath;
  if (unlabelled(draft)) draft.actionLabel = fileAction(draft.toolName, lastSegment(filePath));
  draft.keyParams.push({ label: "File", value: filePath });
  const lines = lineRange(args);
  if (lines) draft.keyParams.push({ label: "Lines", value: lines });
  if (Array.isArray(args.ReplacementChunks)) {
    const chunks = args.ReplacementChunks.length;
    draft.keyParams.push({ label: "Edits", value: `${chunks} chunk${chunks === 1 ? "" : "s"}` });
  }
}

function readDirectory(args: ToolArguments, draft: SummaryDraft): void {
  if (typeof args.DirectoryPath !== "string") return;
  draft.target = args.DirectoryPath;
  if (unlabelled(draft)) draft.actionLabel = `List: ${lastSegment(args.DirectoryPath)}`;
  draft.keyParams.push({ label: "Directory", value: args.DirectoryPath });
}

function searchQuery(args: ToolArguments, toolName: string): string | undefined {
  const query = firstNonEmpty(args, ARGUMENT_NAMES.query);
  if (query) return query;
  // Smart search_codebase describes what to find instead of a pattern.
  return toolName === "search_codebase" ? firstNonEmpty(args, ["request"]) : undefined;
}

function readQuery(args: ToolArguments, draft: SummaryDraft): void {
  const query = searchQuery(args, draft.toolName);
  if (!query) {
    // Smart read_file: the path is the target; the request says what was needed from it.
    const request = firstNonEmpty(args, ["request"]);
    if (request) draft.keyParams.push({ label: "Request", value: request });
    return;
  }
  draft.target = query;
  draft.actionLabel = `Search: "${query}"`;
  draft.keyParams.push({ label: "Query", value: query });
  if (typeof args.SearchPath === "string") draft.keyParams.push({ label: "Search In", value: args.SearchPath });
  if (draft.toolName !== "search_codebase") return;
  if (isNonEmptyString(args.path)) draft.keyParams.push({ label: "Search In", value: args.path });
  if (isNonEmptyString(args.include)) draft.keyParams.push({ label: "Include", value: args.include });
}

function readUrl(args: ToolArguments, draft: SummaryDraft): void {
  if (typeof args.Url !== "string" && typeof args.url !== "string") return;
  const url = String(args.Url || args.url);
  draft.target = url;
  draft.actionLabel = draft.toolName === "web_extract" ? `Extract: ${url}` : `Fetch: ${url}`;
  draft.keyParams.push({ label: "URL", value: url });
}

/** e.g. generate_image */
function readPrompt(args: ToolArguments, draft: SummaryDraft): void {
  if (!isNonEmptyString(args.Prompt)) return;
  draft.actionLabel = `Generate: ${args.Prompt.slice(0, 60)}`;
  draft.keyParams.push({ label: "Prompt", value: args.Prompt });
}

/** A subagent or browser task. */
function readTask(args: ToolArguments, draft: SummaryDraft): void {
  if (!isNonEmptyString(args.TaskName)) return;
  draft.actionLabel = args.TaskName;
  draft.keyParams.push({ label: "Task", value: args.TaskName });
}

/** Applied in this order: a later reader's target and action win over an earlier one's. */
export const CALL_READERS: Array<(args: ToolArguments, draft: SummaryDraft) => void> = [
  readCommand,
  readFile,
  readDirectory,
  readQuery,
  readUrl,
  readPrompt,
  readTask,
];
