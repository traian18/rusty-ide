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
  model: "gpt-4o",
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
      expect(container.textContent).toContain("Timeline view per run");
      expect(container.textContent).not.toContain("DeepSeek");
      expect(container.textContent).toContain("gpt-4o");

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

  it("stacks multiple workflow runs vertically with newest on top and independent run contexts", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // Run 1: Oldest run
    const timeRun1 = new Date(1700000000000).toISOString();
    trajectories.start("run-1", { surface: "agent", displayLabel: "Run 1" }, {
      capability: "agent_chat",
      requestPrompt: "First task: read documentation",
    });
    // Override startedAt to guarantee deterministic timestamp
    (trajectories.getSnapshot().runs.find(r => r.id === "run-1") as any).startedAt = timeRun1;
    executionObservability.startRun("run-1", "agent_chat", {
      ...INPUT,
      message: "First task: read documentation",
    });
    executionObservability.ingest("run-1", {
      ...envelope({
        ToolCallRequested: { call: { id: "call-run1", name: "fs.read", arguments: { path: "README.md" } } }
      }, 1),
      timestamp: timeRun1,
      run_id: "run-1",
    });
    executionObservability.ingest("run-1", {
      ...envelope({
        ToolCallCompleted: { call_id: "call-run1", result: { has_error: false, output_preview: "# Docs" } }
      }, 2),
      timestamp: timeRun1,
      run_id: "run-1",
    });
    executionObservability.finishRun("run-1", { status: "completed" });

    // Run 2: Middle run (same session)
    const timeRun2 = new Date(1700000060000).toISOString();
    trajectories.start("run-2", { surface: "agent", displayLabel: "Run 2" }, {
      capability: "agent_chat",
      requestPrompt: "Second task: write unit test",
    });
    (trajectories.getSnapshot().runs.find(r => r.id === "run-2") as any).startedAt = timeRun2;
    executionObservability.startRun("run-2", "agent_chat", {
      ...INPUT,
      message: "Second task: write unit test",
    });
    executionObservability.ingest("run-2", {
      ...envelope({
        ToolCallRequested: { call: { id: "call-run2", name: "fs.write", arguments: { path: "test.rs" } } }
      }, 3),
      timestamp: timeRun2,
      run_id: "run-2",
    });
    executionObservability.ingest("run-2", {
      ...envelope({
        ToolCallCompleted: { call_id: "call-run2", result: { has_error: false, output_preview: "test created" } }
      }, 4),
      timestamp: timeRun2,
      run_id: "run-2",
    });
    executionObservability.finishRun("run-2", { status: "completed" });

    // Run 3: Newest run
    const timeRun3 = new Date(1700000120000).toISOString();
    trajectories.start("run-3", { surface: "agent", displayLabel: "Run 3" }, {
      capability: "agent_chat",
      requestPrompt: "Third task: run integration suite",
    });
    (trajectories.getSnapshot().runs.find(r => r.id === "run-3") as any).startedAt = timeRun3;
    executionObservability.startRun("run-3", "agent_chat", {
      ...INPUT,
      message: "Third task: run integration suite",
    });
    executionObservability.ingest("run-3", {
      ...envelope({
        ToolCallRequested: { call: { id: "call-run3", name: "bash.exec", arguments: { command: "cargo test" } } }
      }, 5),
      timestamp: timeRun3,
      run_id: "run-3",
    });
    executionObservability.ingest("run-3", {
      ...envelope({
        ToolCallCompleted: { call_id: "call-run3", result: { has_error: false, output_preview: "test result: ok" } }
      }, 6),
      timestamp: timeRun3,
      run_id: "run-3",
    });
    executionObservability.finishRun("run-3", { status: "completed" });

    try {
      await act(async () => {
        root.render(<ToolExecutionPanel onClose={vi.fn()} />);
      });

      // Total executions header count
      expect(container.textContent).toContain("3 calls across 3 executions");

      // Verify that 3 individual runCard elements rendered
      const runArticles = Array.from(container.querySelectorAll("article"));
      expect(runArticles.length).toBe(3);

      // Verify newest on top: index 0 must be Run 3, index 1 Run 2, index 2 Run 1
      expect(runArticles[0].textContent).toContain("Third task: run integration suite");
      expect(runArticles[0].textContent).toContain("bash.exec");

      expect(runArticles[1].textContent).toContain("Second task: write unit test");
      expect(runArticles[1].textContent).toContain("fs.write");

      expect(runArticles[2].textContent).toContain("First task: read documentation");
      expect(runArticles[2].textContent).toContain("fs.read");

      // Verify neither "succeeded" nor "failed" status badge is shown on runs
      for (const article of runArticles) {
        expect(article.querySelector('[class*="runStatus_succeeded"]')).toBeNull();
        expect(article.querySelector('[class*="runStatus_failed"]')).toBeNull();
      }

      // Click on the tool in the middle run (fs.write)
      const writeButton = Array.from(runArticles[1].querySelectorAll("button")).find(
        b => b.textContent?.includes("fs.write")
      );
      expect(writeButton).toBeTruthy();

      await act(async () => {
        writeButton?.click();
      });

      // Inspector displays fs.write details with Run 2's specific context prompt, NOT Run 1 or 3
      const inspector = container.querySelector('[aria-label="Execution details inspector"]');
      expect(inspector?.textContent).toContain("Execution Details: fs.write");
      expect(inspector?.textContent).not.toContain("Succeeded ·");
      expect(inspector?.textContent).not.toContain("Failed ·");
      expect(inspector?.textContent).toContain("Run Context (Initiating Prompt)");
      expect(inspector?.textContent).toContain("Second task: write unit test");
      expect(inspector?.textContent).not.toContain("First task: read documentation");
      expect(inspector?.textContent).not.toContain("Third task: run integration suite");

      // Click on the long command in Run 3
      const cmdButton = Array.from(runArticles[0].querySelectorAll("button")).find(
        b => b.textContent?.includes("bash.exec")
      );
      expect(cmdButton).toBeTruthy();
      await act(async () => {
        cmdButton?.click();
      });

      // Command is truncated to 25 chars + ...
      expect(cmdButton?.textContent).toContain("cargo test");
      expect(inspector?.textContent).toContain("Execution Details: bash.exec");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("auto-heals stuck tool records in finished trajectories so they do not appear as running", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = vi.fn();

    // Start a run, start a tool call, but simulate the run finishing (e.g. process completed or ended)
    // without the tool receiving a ToolCallCompleted event.
    executionObservability.startRun("stuck-run", "agent_chat", {
      ...INPUT,
      message: "Stuck process test",
    });
    executionObservability.ingest("stuck-run", envelope({
      ToolCallRequested: { call: { id: "call-stuck", name: "bash.exec", arguments: { command: "sleep 100" } } },
    }, 1));
    executionObservability.ingest("stuck-run", envelope({
      ToolCallStarted: { call_id: "call-stuck" },
    }, 2));
    // The run finished (e.g. timeout or completed)
    trajectories.finish("stuck-run", "completed", { response: "Finished" });

    try {
      await act(async () => {
        root.render(<ToolExecutionPanel onClose={onClose} />);
      });

      // The run should NOT display as "Running"
      expect(container.textContent).not.toContain("Running");
      expect(container.textContent).toContain("Stuck process test");

      // The tool node on the timeline should NOT have a spinning loader
      const spinLoaders = container.querySelectorAll(".animate-spin");
      expect(spinLoaders.length).toBe(0);

      // Clicking on the healed tool shows it as resolved, not live
      const toolButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes("sleep 100"));
      expect(toolButton).toBeTruthy();
      await act(async () => {
        toolButton?.click();
      });

      expect(container.textContent).toContain("Process ended before a terminal tool event was recorded.");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("closes when the modal backdrop overlay is clicked", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = vi.fn();

    try {
      await act(async () => {
        root.render(<ToolExecutionPanel onClose={onClose} />);
      });

      const overlay = container.firstElementChild as HTMLElement;
      expect(overlay).toBeTruthy();

      // Click on the overlay backdrop itself
      await act(async () => {
        overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});


