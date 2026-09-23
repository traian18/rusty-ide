import { describe, expect, it } from "vitest";
import { extractCallSummary, formatCompactCallLabel, truncateCommand } from "./callSummary";
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
        origin: { surface: "agent", displayLabel: "Agent" },
        context: { capability: "agent_chat" },
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
        origin: { surface: "agent", displayLabel: "Agent" },
        context: { capability: "agent_chat" },
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
