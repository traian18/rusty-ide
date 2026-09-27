import type { ToolExecutionRecord, ToolExecutor } from "../../observability/types";

export interface CallSummary {
  actionLabel: string;
  summary?: string;
  target?: string;
  description?: string;
  instruction?: string;
  keyParams: { label: string; value: string }[];
}

export function extractCallSummary(record: ToolExecutionRecord): CallSummary {
  const args = (record.arguments && typeof record.arguments === "object")
    ? record.arguments as Record<string, unknown>
    : null;

  let actionLabel = record.toolName;
  let summary: string | undefined;
  let target: string | undefined;
  let description: string | undefined;
  let instruction: string | undefined;
  const keyParams: { label: string; value: string }[] = [];

  if (args) {
    if (typeof args.toolAction === "string" && args.toolAction.trim()) {
      actionLabel = args.toolAction.trim();
    }
    if (typeof args.toolSummary === "string" && args.toolSummary.trim()) {
      summary = args.toolSummary.trim();
    }
    if (typeof args.Description === "string" && args.Description.trim()) {
      description = args.Description.trim();
    } else if (typeof args.description === "string" && args.description.trim()) {
      description = args.description.trim();
    }
    if (typeof args.Instruction === "string" && args.Instruction.trim()) {
      instruction = args.Instruction.trim();
    } else if (typeof args.instruction === "string" && args.instruction.trim()) {
      instruction = args.instruction.trim();
    }

    // Command execution
    const rawCmd =
      (typeof args.CommandLine === "string" && args.CommandLine.trim()) ||
      (typeof args.command === "string" && args.command.trim()) ||
      (typeof args.cmd === "string" && args.cmd.trim()) ||
      (typeof args.program === "string" && args.program.trim()
        ? Array.isArray(args.args)
          ? `${args.program.trim()} ${args.args.join(" ")}`
          : args.program.trim()
        : null);

    if (rawCmd) {
      const displayCmd = truncateCommand(rawCmd);
      target = displayCmd;
      actionLabel = `Run: ${displayCmd}`;
      keyParams.push({ label: "Command", value: displayCmd });
      if (typeof args.Cwd === "string") keyParams.push({ label: "Directory", value: args.Cwd });
    }

    // File target
    const filePath =
      (typeof args.TargetFile === "string" && args.TargetFile) ||
      (typeof args.AbsolutePath === "string" && args.AbsolutePath) ||
      (typeof args.path === "string" && args.path) ||
      (typeof args.filePath === "string" && args.filePath) ||
      (typeof args.file_path === "string" && args.file_path);

    if (filePath) {
      const fileName = filePath.split("/").pop() || filePath;
      target = filePath;
      if (actionLabel === record.toolName) {
        if (record.toolName.includes("replace") || record.toolName.includes("edit") || record.toolName.includes("write")) {
          actionLabel = `Edit: ${fileName}`;
        } else if (record.toolName.includes("view") || record.toolName.includes("read")) {
          actionLabel = `View: ${fileName}`;
        } else {
          actionLabel = `${record.toolName} → ${fileName}`;
        }
      }
      keyParams.push({ label: "File", value: filePath });

      if (args.StartLine !== undefined || args.EndLine !== undefined) {
        keyParams.push({
          label: "Lines",
          value: `${args.StartLine ?? 1}–${args.EndLine ?? "end"}`
        });
      }
      if (Array.isArray(args.ReplacementChunks)) {
        keyParams.push({
          label: "Edits",
          value: `${args.ReplacementChunks.length} chunk${args.ReplacementChunks.length === 1 ? "" : "s"}`
        });
      }
    }

    // Directory
    if (typeof args.DirectoryPath === "string") {
      target = args.DirectoryPath;
      if (actionLabel === record.toolName) {
        actionLabel = `List: ${args.DirectoryPath.split("/").pop() || args.DirectoryPath}`;
      }
      keyParams.push({ label: "Directory", value: args.DirectoryPath });
    }

    // Search query
    const query =
      (typeof args.Query === "string" && args.Query) ||
      (typeof args.query === "string" && args.query) ||
      (typeof args.pattern === "string" && args.pattern) ||
      // Smart search_codebase describes what to find instead of a pattern.
      (record.toolName === "search_codebase" && typeof args.request === "string" && args.request);

    if (query) {
      target = query;
      actionLabel = `Search: "${query}"`;
      keyParams.push({ label: "Query", value: query });
      if (typeof args.SearchPath === "string") {
        keyParams.push({ label: "Search In", value: args.SearchPath });
      }
      if (record.toolName === "search_codebase") {
        if (typeof args.path === "string" && args.path) keyParams.push({ label: "Search In", value: args.path });
        if (typeof args.include === "string" && args.include) keyParams.push({ label: "Include", value: args.include });
      }
    } else if (typeof args.request === "string" && args.request) {
      // Smart read_file: the path is the target; the request says what was needed from it.
      keyParams.push({ label: "Request", value: args.request });
    }

    // URL
    if (typeof args.Url === "string" || typeof args.url === "string") {
      const url = String(args.Url || args.url);
      target = url;
      actionLabel = record.toolName === "web_extract" ? `Extract: ${url}` : `Fetch: ${url}`;
      keyParams.push({ label: "URL", value: url });
    }

    // Prompt (e.g. generate_image)
    if (typeof args.Prompt === "string" && args.Prompt) {
      actionLabel = `Generate: ${args.Prompt.slice(0, 60)}`;
      keyParams.push({ label: "Prompt", value: args.Prompt });
    }

    // Subagent or browser task
    if (typeof args.TaskName === "string" && args.TaskName) {
      actionLabel = args.TaskName;
      keyParams.push({ label: "Task", value: args.TaskName });
    }
  }

  if (summary && !keyParams.some((k) => k.label === "Summary")) {
    keyParams.push({ label: "Summary", value: summary });
  }
  if (description && !keyParams.some((k) => k.label === "Description")) {
    keyParams.push({ label: "Description", value: description });
  }
  if (instruction && !keyParams.some((k) => k.label === "Instruction")) {
    keyParams.push({ label: "Instruction", value: instruction });
  }

  return { actionLabel, summary, target, description, instruction, keyParams };
}

export function truncateCommand(cmd: string): string {
  const trimmed = cmd.trim();
  if (trimmed.length <= 25) return trimmed;
  return `${trimmed.slice(0, 25)}...`;
}

export function formatCompactCallLabel(record: ToolExecutionRecord): string {
  const summary = extractCallSummary(record);
  if (summary.target) {
    const shortTarget = summary.target.length > 25
      ? `${summary.target.slice(0, 25)}...`
      : summary.target;
    return `${record.toolName}: ${shortTarget}`;
  }
  return record.toolName;
}

/** "claude-haiku (Anthropic)" for a model, "tavily" for a service. */
export function formatToolExecutor(executor: ToolExecutor): string {
  if (executor.model) return executor.provider ? `${executor.model} (${executor.provider})` : executor.model;
  return executor.provider ?? executor.purpose;
}

export interface CallModels {
  /** The model that issued the call. */
  requestedBy: string;
  /** The model or service that did the work, or why there is none. */
  executedBy: string;
  /** True when something other than the requesting model did the work. */
  delegated: boolean;
}

const ACTIVE = new Set(["queued", "waiting-permission", "running"]);

/** Which models a tool call involved, for every tool: a delegated model or
 * service when the tool reported one, otherwise an explicit "no model". */
export function describeCallModels(record: ToolExecutionRecord): CallModels {
  const requester = record.requestedBy?.model ?? record.context.model ?? "unknown model";
  const requestedBy = record.requestedBy?.subagent ? `${requester} (subagent)` : requester;
  const executor = record.execution?.executor;
  if (executor) return { requestedBy, executedBy: `${formatToolExecutor(executor)} · ${executor.purpose}`, delegated: true };
  const executedBy = ACTIVE.has(record.status) ? "Not reported yet" : "No model (tool runs as code)";
  return { requestedBy, executedBy, delegated: false };
}
