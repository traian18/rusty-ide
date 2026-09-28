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
