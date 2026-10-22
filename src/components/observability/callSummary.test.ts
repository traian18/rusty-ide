import { describe, expect, it } from "vitest";
import { describeCallModels, extractCallSummary, formatCompactCallLabel, truncateCommand } from "./callSummary";
import type { ToolExecutionRecord } from "../../observability/types";

describe("callSummary", () => {
  describe("truncateCommand", () => {
    it("returns short commands unchanged when 25 characters or fewer", () => {
      expect(truncateCommand("cargo build")).toBe("cargo build");
      expect(truncateCommand("1234567890123456789012345")).toBe("1234567890123456789012345");
    });

    it("truncates commands longer than 25 characters to first 25 characters followed by ...", () => {
      const command = "cargo test --test leak_test -- --nocapture";
      expect(truncateCommand(command)).toBe("cargo test --test leak_te...");
      expect(truncateCommand(command).startsWith("cargo test --test leak_te")).toBe(true);
      expect(truncateCommand(command).endsWith("...")).toBe(true);
      expect(truncateCommand(command).slice(0, 25)).toBe("cargo test --test leak_te");
    });
  });

  describe("extractCallSummary and formatCompactCallLabel", () => {
    it("truncates long command lines in actionLabel, keyParams, and compact label", () => {
      const record: ToolExecutionRecord = {
        id: "call-1",
        callId: "call-1",
        ideRunId: "run-1",
        toolName: "run_command",
        status: "succeeded",
        requestedAt: new Date().toISOString(),
        origin: { surface: "agent-tab", displayLabel: "Agent" },
        context: { capability: "agent_chat", inputKeys: [], fileReferences: [], mcpServers: [] },
        arguments: {
          CommandLine: "cargo test --test leak_test -- --nocapture",
          Cwd: "/workspace/rusty",
        },
        payloadState: "full",
      };

      const summary = extractCallSummary(record);
      expect(summary.actionLabel).toBe("Run: cargo test --test leak_te...");
      expect(summary.target).toBe("cargo test --test leak_te...");
      expect(summary.keyParams.find((p) => p.label === "Command")?.value).toBe("cargo test --test leak_te...");

      const compact = formatCompactCallLabel(record);
      expect(compact).toBe("run_command: cargo test --test leak_te...");
    });

    it("preserves short commands without truncation", () => {
      const record: ToolExecutionRecord = {
        id: "call-2",
        callId: "call-2",
        ideRunId: "run-1",
        toolName: "run_command",
        status: "succeeded",
        requestedAt: new Date().toISOString(),
        origin: { surface: "agent-tab", displayLabel: "Agent" },
        context: { capability: "agent_chat", inputKeys: [], fileReferences: [], mcpServers: [] },
        arguments: {
          CommandLine: "git status",
        },
        payloadState: "full",
      };

      const summary = extractCallSummary(record);
      expect(summary.actionLabel).toBe("Run: git status");
      expect(summary.target).toBe("git status");

      const compact = formatCompactCallLabel(record);
      expect(compact).toBe("run_command: git status");
    });
  });
});

describe("smart retrieval call summaries", () => {
  const base = {
    id: "c", callId: "c", ideRunId: "r", status: "succeeded" as const, requestedAt: new Date().toISOString(),
    origin: { surface: "agent-tab" as const, displayLabel: "Agent" },
    context: { capability: "agent_chat" as const, inputKeys: [], fileReferences: [], mcpServers: [] },
    payloadState: "full" as const,
  };

  it("labels a smart search by its request and shows its scope", () => {
    const record: ToolExecutionRecord = { ...base, toolName: "search_codebase", arguments: { request: "auth errors", path: "src", include: "*.ts" } };
    const summary = extractCallSummary(record);
    expect(summary.actionLabel).toBe('Search: "auth errors"');
    expect(summary.keyParams).toEqual(expect.arrayContaining([{ label: "Search In", value: "src" }, { label: "Include", value: "*.ts" }]));
    expect(formatCompactCallLabel(record)).toBe("search_codebase: auth errors");
  });

  it("shows a smart read's request alongside its path", () => {
    const record: ToolExecutionRecord = { ...base, toolName: "read_file", arguments: { path: "src/a.ts", request: "the validator" } };
    expect(extractCallSummary(record).keyParams).toContainEqual({ label: "Request", value: "the validator" });
  });

  it("labels a web extraction by its URL and shows the request", () => {
    const record: ToolExecutionRecord = { ...base, toolName: "web_extract", arguments: { url: "https://docs.example.com", request: "rate limits" } };
    const summary = extractCallSummary(record);
    expect(summary.actionLabel).toBe("Extract: https://docs.example.com");
    expect(summary.keyParams).toContainEqual({ label: "Request", value: "rate limits" });
  });

  const summarize = (toolName: string, args?: unknown) => extractCallSummary({ ...base, toolName, arguments: args } as ToolExecutionRecord);

  it("keeps the tool name and adds nothing without arguments", () => {
    expect(summarize("list_files")).toEqual({ actionLabel: "list_files", keyParams: [] });
    expect(summarize("list_files", "not an object")).toEqual({ actionLabel: "list_files", keyParams: [] });
  });

  it("uses the model's own action, summary, description and instruction, trimmed, after the tool's params", () => {
    expect(summarize("custom", {
      toolAction: "  Check the build  ", toolSummary: " compiles cleanly ",
      Description: "   ", description: " lower-case description ", Instruction: " Run it ", instruction: "ignored",
    })).toEqual({
      actionLabel: "Check the build",
      summary: "compiles cleanly",
      description: "lower-case description",
      instruction: "Run it",
      keyParams: [
        { label: "Summary", value: "compiles cleanly" },
        { label: "Description", value: "lower-case description" },
        { label: "Instruction", value: "Run it" },
      ],
    });
  });

  it("builds a command from a program and its args, and keeps a blank working directory", () => {
    expect(summarize("exec", { command: "  ", program: " ls ", args: ["-la", "src"], Cwd: "" })).toEqual({
      actionLabel: "Run: ls -la src",
      target: "ls -la src",
      keyParams: [{ label: "Command", value: "ls -la src" }, { label: "Directory", value: "" }],
    });
    expect(summarize("exec", { cmd: "pwd", program: "ignored" }).target).toBe("pwd");
    expect(summarize("exec", { program: "make" }).target).toBe("make");
  });

  it("labels a file by what the tool does to it, with its line range and edit count", () => {
    expect(summarize("replace_file_content", { TargetFile: "/ws/src/app.ts", StartLine: 3, ReplacementChunks: [{}] })).toEqual({
      actionLabel: "Edit: app.ts",
      target: "/ws/src/app.ts",
      keyParams: [
        { label: "File", value: "/ws/src/app.ts" },
        { label: "Lines", value: "3–end" },
        { label: "Edits", value: "1 chunk" },
      ],
    });
    expect(summarize("view_file", { AbsolutePath: "/ws/a.ts", EndLine: 9, ReplacementChunks: [{}, {}] }).keyParams).toEqual([
      { label: "File", value: "/ws/a.ts" },
      { label: "Lines", value: "1–9" },
      { label: "Edits", value: "2 chunks" },
    ]);
    expect(summarize("view_file", { AbsolutePath: "/ws/a.ts" }).actionLabel).toBe("View: a.ts");
    expect(summarize("stat", { filePath: "dir/" }).actionLabel).toBe("stat → dir/");
    expect(summarize("stat", { file_path: "notes.md" }).actionLabel).toBe("stat → notes.md");
    expect(summarize("write_file", { toolAction: "Save", path: "a.ts" }).actionLabel).toBe("Save");
  });

  it("lists a directory, even an empty path, unless something already named the action", () => {
    expect(summarize("list_dir", { DirectoryPath: "/ws/src" })).toEqual({
      actionLabel: "List: src",
      target: "/ws/src",
      keyParams: [{ label: "Directory", value: "/ws/src" }],
    });
    expect(summarize("list_dir", { DirectoryPath: "" })).toEqual({ actionLabel: "List: ", target: "", keyParams: [{ label: "Directory", value: "" }] });
    expect(summarize("list_dir", { command: "ls", DirectoryPath: "/ws" }).actionLabel).toBe("Run: ls");
  });

  it("labels a search by its query, after any file it names", () => {
    expect(summarize("grep_search", { path: "src/a.ts", Query: "TODO", SearchPath: "" })).toEqual({
      actionLabel: 'Search: "TODO"',
      target: "TODO",
      keyParams: [
        { label: "File", value: "src/a.ts" },
        { label: "Query", value: "TODO" },
        { label: "Search In", value: "" },
      ],
    });
    expect(summarize("grep", { pattern: "fn main", request: "not a query here" }).keyParams).toEqual([{ label: "Query", value: "fn main" }]);
    expect(summarize("search_codebase", { query: "auth", path: "", include: "" }).keyParams).toEqual([{ label: "Query", value: "auth" }]);
  });

  it("labels fetched and extracted URLs, generated prompts and tasks, later ones winning", () => {
    expect(summarize("read_url_content", { Url: "https://a.dev", url: "https://b.dev" })).toEqual({
      actionLabel: "Fetch: https://a.dev",
      target: "https://a.dev",
      keyParams: [{ label: "URL", value: "https://a.dev" }],
    });
    expect(summarize("fetch", { Url: "", url: 5 }).target).toBe("5");
    expect(summarize("fetch", { Url: "" }).target).toBe("undefined");
    const prompt = "x".repeat(70);
    expect(summarize("generate_image", { Prompt: prompt, TaskName: "" })).toEqual({
      actionLabel: `Generate: ${"x".repeat(60)}`,
      keyParams: [{ label: "Prompt", value: prompt }],
    });
    expect(summarize("browser_subagent", { url: "https://c.dev", Prompt: "p", TaskName: "Check the docs" })).toEqual({
      actionLabel: "Check the docs",
      target: "https://c.dev",
      keyParams: [
        { label: "URL", value: "https://c.dev" },
        { label: "Prompt", value: "p" },
        { label: "Task", value: "Check the docs" },
      ],
    });
  });

  it("names the models of every call, including tools that use none", () => {
    const deterministic: ToolExecutionRecord = { ...base, toolName: "list_files", requestedBy: { model: "gpt-4o" } };
    expect(describeCallModels(deterministic)).toEqual({ requestedBy: "gpt-4o", executedBy: "No model (tool runs as code)", delegated: false });
    expect(describeCallModels({ ...deterministic, status: "running" }).executedBy).toBe("Not reported yet");

    const subagentCall: ToolExecutionRecord = {
      ...base,
      toolName: "read_file",
      requestedBy: { model: "claude-haiku-4-5", subagent: true },
      execution: { executor: { kind: "model", purpose: "Smart Read selector", model: "selector-mini", provider: "Sel" }, steps: [] },
    };
    expect(describeCallModels(subagentCall)).toEqual({
      requestedBy: "claude-haiku-4-5 (subagent)",
      executedBy: "selector-mini (Sel) · Smart Read selector",
      delegated: true,
    });
  });
});
