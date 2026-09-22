// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolExecutionPanel } from "./ToolExecutionPanel";
import { executionObservability } from "../../observability/executionStore";
import { trajectories } from "../../observability/trajectoryStore";
import type { AgentEventEnvelope } from "@rusty/harness-sdk";

const INPUT = {
  tabId: "agent",
  message: "Refactor database service",
  workspaceRoot: "/workspace",
  model: "deepseek-coder",
  chatHistory: [],
  mcpServers: [],
  customProvider: null,
  skill: null,
  planOnly: false,
  vfsOnly: false,
  lspSettings: {},
};

function envelope(event: any, sequence: number): AgentEventEnvelope {
  return {
    event_id: `ev-${sequence}`,
    session_id: "sess-1",
    agent_id: "agent-1",
    parent_agent_id: null,
    run_id: "run-abc",
    agent_sequence: sequence,
    session_sequence: sequence,
    timestamp: new Date(1700000000000 + sequence * 1000).toISOString(),
    visibility: "User",
    event,
  };
}

describe("ToolExecutionPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    executionObservability.clear();
    trajectories.remove(() => true);
  });

  it("renders fullscreen panel with runs grouped into time-series execution charts", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = vi.fn();

    // Setup an IDE run with two tool calls
    executionObservability.startRun("run-abc", "agent_chat", INPUT, { displayLabel: "Agent Chat" });
    executionObservability.ingest("run-abc", envelope({
      ToolCallRequested: { call: { id: "call-1", name: "fs.read", arguments: { path: "src/main.rs" } } },
    }, 1));
    executionObservability.ingest("run-abc", envelope({ ToolCallStarted: { call_id: "call-1" } }, 2));
    executionObservability.ingest("run-abc", envelope({
      ToolCallCompleted: { call_id: "call-1", result: { has_error: false, output_preview: "fn main() {}" } },
    }, 3));

    executionObservability.ingest("run-abc", envelope({
      ToolCallRequested: { call: { id: "call-2", name: "fs.write", arguments: { path: "src/lib.rs" } } },
    }, 4));
    executionObservability.ingest("run-abc", envelope({ ToolCallStarted: { call_id: "call-2" } }, 5));
    executionObservability.ingest("run-abc", envelope({
      ToolCallCompleted: { call_id: "call-2", result: { has_error: false, output_preview: "written 42 bytes" } },
    }, 6));
    executionObservability.finishRun("run-abc", { status: "completed", result: { response: "Done", modifiedFiles: [], subagents: [] } });

    try {
      await act(async () => {
        root.render(<ToolExecutionPanel onClose={onClose} />);
      });

      // Header title & metrics
      expect(container.textContent).toContain("Tool Execution Observability");
      expect(container.textContent).toContain("DeepSeek timeline view");
      expect(container.textContent).toContain("deepseek-coder");

      // Grouped run card contains both tools on the timeline
      expect(container.textContent).toContain("fs.read");
      expect(container.textContent).toContain("fs.write");

      // Before clicking a point, Execution Details container is not active
      expect(container.textContent).not.toContain("Execution Details: fs.read");

      // Click on the first tool point (fs.read)
      const toolButtons = Array.from(container.querySelectorAll("button")).filter(b => b.textContent?.includes("fs.read"));
      expect(toolButtons.length).toBeGreaterThan(0);

      await act(async () => {
        toolButtons[0].click();
      });

      // Now Execution Details for fs.read are displayed inline under the chart!
      expect(container.textContent).toContain("Execution Details: fs.read");
      expect(container.textContent).toContain("src/main.rs");
      expect(container.textContent).toContain("fn main() {}");

      // Click on fs.write
      const writeButtons = Array.from(container.querySelectorAll("button")).filter(b => b.textContent?.includes("fs.write"));
      await act(async () => {
        writeButtons[0].click();
      });

      expect(container.textContent).toContain("Execution Details: fs.write");
      expect(container.textContent).toContain("written 42 bytes");

      // Escape key closes panel
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(onClose).toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("displays right-side inspector with distinct call action and shared run context notice", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    executionObservability.startRun("run-xyz", "agent_chat", {
      ...INPUT,
      message: "Find and fix memory leak",
    }, { displayLabel: "Agent Chat" });

    executionObservability.ingest("run-xyz", envelope({
      ToolCallRequested: {
        call: {
          id: "call-grep",
          name: "grep_search",
          arguments: { Query: "alloc::raw_vec", toolAction: "Searching memory allocations" }
        }
      }
    }, 1));
    executionObservability.ingest("run-xyz", envelope({ ToolCallStarted: { call_id: "call-grep" } }, 2));
    executionObservability.ingest("run-xyz", envelope({
      ToolCallCompleted: { call_id: "call-grep", result: { has_error: false, output_preview: "found 3 matches" } }
    }, 3));

    executionObservability.ingest("run-xyz", envelope({
      ToolCallRequested: {
        call: {
          id: "call-cmd",
          name: "run_command",
          arguments: { CommandLine: "cargo test --test leak_test", toolAction: "Running leak test" }
        }
      }
    }, 4));
    executionObservability.ingest("run-xyz", envelope({ ToolCallStarted: { call_id: "call-cmd" } }, 5));
    executionObservability.ingest("run-xyz", envelope({
      ToolCallCompleted: { call_id: "call-cmd", result: { has_error: false, output_preview: "test result: ok" } }
    }, 6));
    executionObservability.finishRun("run-xyz", { status: "completed", result: { response: "All fixed", modifiedFiles: [], subagents: [] } });

    try {
      await act(async () => {
        root.render(<ToolExecutionPanel onClose={vi.fn()} />);
      });

      // Right-side inspector initially shows empty placeholder prompt
      const inspector = container.querySelector('[aria-label="Execution details inspector"]');
      expect(inspector).toBeTruthy();
      expect(inspector?.textContent).toContain("No tool call selected");

      // Click on grep_search
      const grepButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes("grep_search"));
      expect(grepButton).toBeTruthy();
      await act(async () => {
        grepButton!.click();
      });

      // Shows what THIS call is doing distinctly
      expect(inspector?.textContent).toContain("Searching memory allocations");
      expect(inspector?.textContent).toContain("alloc::raw_vec");
      // Shows shared Run Context with clarifying notice
      expect(inspector?.textContent).toContain("Run Context (Initiating Prompt)");
      expect(inspector?.textContent).toContain("Find and fix memory leak");
      expect(inspector?.textContent).toContain("All tool calls within this run share the same initiating user request");

      // Click on run_command
      const cmdButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes("run_command"));
      expect(cmdButton).toBeTruthy();
      await act(async () => {
        cmdButton!.click();
      });

      // Shows what the command call is doing distinctly
      expect(inspector?.textContent).toContain("cargo test --test leak_test");
      expect(inspector?.textContent).toContain("test result: ok");
      // Still shows the shared initiating prompt
      expect(inspector?.textContent).toContain("Find and fix memory leak");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("unifies all information per execution, removes 3 tabs, and includes AssistantTextDelta in time series", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    executionObservability.startRun("run-assistant", "agent_chat", {
      ...INPUT,
      message: "Explain architectural layers",
    }, { displayLabel: "Agent Chat" });

    // Step 1: Assistant text delta
    executionObservability.ingest("run-assistant", envelope({
      AssistantTextDelta: { message_id: "msg-1", delta: "I will examine the codebase structure." }
    }, 1));

    // Step 2: Tool call
    executionObservability.ingest("run-assistant", envelope({
      ToolCallRequested: { call: { id: "call-tree", name: "fs.list_dir", arguments: { path: "src" } } }
    }, 2));
    executionObservability.ingest("run-assistant", envelope({ ToolCallStarted: { call_id: "call-tree" } }, 3));
    executionObservability.ingest("run-assistant", envelope({
      ToolCallCompleted: { call_id: "call-tree", result: { has_error: false, output_preview: "components, services" } }
    }, 4));

    // Step 3: Usage updated with token metrics
    executionObservability.ingest("run-assistant", envelope({
      UsageUpdated: {
        usage: {
          agent_id: "agent-1",
          timestamp: new Date().toISOString(),
          metrics: {
            total_tokens: 3200,
            input_tokens: 2800,
            output_tokens: 400,
          },
        } as never,
      }
    }, 5));

    // Step 4: Assistant text delta follow-up
    executionObservability.ingest("run-assistant", envelope({
      AssistantTextDelta: { message_id: "msg-2", delta: "Here is the final architecture diagram and analysis." }
    }, 6));

    executionObservability.finishRun("run-assistant", {
      status: "completed",
      result: { response: "Done", modifiedFiles: [], subagents: [] }
    });

    try {
      await act(async () => {
        root.render(<ToolExecutionPanel onClose={vi.fn()} />);
      });

      // Assert that there are NO separate 3 tabs
      expect(container.querySelector('[aria-label="Execution view"]')).toBeNull();
      expect(container.textContent).not.toContain("Run Timelines");
      expect(container.textContent).not.toContain("All Calls");

      // Time series contains both the tool and the AssistantTextDelta nodes!
      const assistantButtons = Array.from(container.querySelectorAll("button")).filter(
        b => b.textContent?.includes("Assistant")
      );
      expect(assistantButtons.length).toBeGreaterThanOrEqual(1);

      const toolButton = Array.from(container.querySelectorAll("button")).find(
        b => b.textContent?.includes("fs.list_dir")
      );
      expect(toolButton).toBeTruthy();

      // Token count on run card shows the true total (3,200 tok), not multiplied or summed
      expect(container.textContent).toContain("3,200 tok");

      // Click on Assistant response node
      await act(async () => {
        assistantButtons[0].click();
      });

      // Inspector now shows the Assistant Response details!
      const inspector = container.querySelector('[aria-label="Execution details inspector"]');
      expect(inspector?.textContent).toContain("Assistant Response");
      expect(inspector?.textContent).toContain("I will examine the codebase structure.");
      expect(inspector?.textContent).toContain("Run Context (Initiating Prompt)");
      expect(inspector?.textContent).toContain("Explain architectural layers");
      expect(inspector?.textContent).toContain("3,200"); // Run token usage
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});


