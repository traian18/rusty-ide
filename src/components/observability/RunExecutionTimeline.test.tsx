// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RunExecutionTimeline } from "./RunExecutionTimeline";
import type { ToolExecutionRecord } from "../../observability/types";

function createMockRecord(overrides: Partial<ToolExecutionRecord>): ToolExecutionRecord {
  return {
    id: "rec-1",
    callId: "call-1",
    ideRunId: "run-1",
    toolName: "workspace.read",
    status: "succeeded",
    requestedAt: new Date(1700000000000).toISOString(),
    startedAt: new Date(1700000000100).toISOString(),
    finishedAt: new Date(1700000000500).toISOString(),
    durationMs: 400,
    payloadState: "full",
    origin: {
      surface: "agent-tab",
      displayLabel: "Agent",
    },
    context: {
      capability: "agent_chat",
      inputKeys: [],
      fileReferences: [],
      mcpServers: [],
    },
    ...overrides,
  };
}

it("renders time-series execution points for tool calls in a run", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const records: ToolExecutionRecord[] = [
    createMockRecord({ id: "rec-1", toolName: "file.read", status: "succeeded", durationMs: 250 }),
    createMockRecord({ id: "rec-2", toolName: "workspace.grep", status: "running", durationMs: undefined }),
    createMockRecord({ id: "rec-3", toolName: "file.write", status: "failed", durationMs: 1200 }),
  ];

  let selectedId: string | null = null;
  const handleSelect = vi.fn((id: string) => {
    selectedId = id;
  });

  try {
    await act(async () => {
      root.render(
        <RunExecutionTimeline
          records={records}
          selectedRecordId={selectedId}
          onSelectRecord={handleSelect}
          runStartedAt={records[0].requestedAt}
        />
      );
    });

    // Check that tool names are rendered in pills
    expect(container.textContent).toContain("file.read");
    expect(container.textContent).toContain("workspace.grep");
    expect(container.textContent).toContain("file.write");

    // Check durations
    expect(container.textContent).toContain("250ms");
    expect(container.textContent).toContain("Live");
    expect(container.textContent).toContain("1.2s");

    // Check clicking a node
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(3);

    await act(async () => {
      buttons[1].click();
    });

    expect(handleSelect).toHaveBeenCalledWith("rec-2");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("renders interleaved timeline items including assistant_text nodes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const items = [
    {
      kind: "assistant_text" as const,
      id: "text-1",
      messageId: "m1",
      text: "Checking files...",
      timestamp: new Date(1700000000000).toISOString(),
    },
    {
      kind: "tool" as const,
      id: "tool-1",
      record: createMockRecord({ id: "tool-1", toolName: "file.read" }),
      timestamp: new Date(1700000001000).toISOString(),
    },
    {
      kind: "assistant_text" as const,
      id: "text-2",
      messageId: "m2",
      text: "Analysis completed successfully.",
      timestamp: new Date(1700000002000).toISOString(),
    },
  ];

  let selectedId: string | null = null;
  const handleSelect = vi.fn((id: string) => {
    selectedId = id;
  });

  try {
    await act(async () => {
      root.render(
        <RunExecutionTimeline
          items={items}
          selectedItemId={selectedId}
          onSelectItem={handleSelect}
          runStartedAt={items[0].timestamp}
        />
      );
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(3);

    // Assistant nodes are rendered with Assistant label and word counts
    expect(container.textContent).toContain("Assistant");
    expect(container.textContent).toContain("file.read");

    // Click on the first assistant response
    await act(async () => {
      buttons[0].click();
    });
    expect(handleSelect).toHaveBeenCalledWith("text-1");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

