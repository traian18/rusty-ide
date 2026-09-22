// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Chat, groupChatMessages, type Message } from "./Chat";

vi.mock("./MarkdownRenderer", async () => {
  const { memo } = await import("react");
  return {
    MarkdownRenderer: memo(({ content }: { content: string }) => (
      <div data-testid="markdown">{content}</div>
    )),
  };
});

vi.mock("../../store", () => {
  const state = { rootPath: "/ws", openTab: vi.fn() };
  return { useWorkspaceStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

describe("groupChatMessages helper", () => {
  it("groups consecutive agent messages into a single group", () => {
    const messages: Message[] = [
      { id: "1", role: "assistant", content: "Step 1", timestamp: "2026-09-20T12:00:00Z" },
      { id: "2", role: "assistant", content: "Step 2", timestamp: "2026-09-20T12:00:05Z" },
      { id: "3", role: "tool-result", content: "Step 3", timestamp: "2026-09-20T12:00:10Z" },
      { id: "4", role: "assistant", content: "Step 4", timestamp: "2026-09-20T12:00:15Z" },
      { id: "5", role: "assistant", content: "Step 5", timestamp: "2026-09-20T12:00:20Z" },
    ];

    const groups = groupChatMessages(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("messages");
    if (groups[0].type === "messages") {
      expect(groups[0].isUser).toBe(false);
      expect(groups[0].messages).toHaveLength(5);
      expect(groups[0].id).toBe("1");
    }
  });

  it("splits groups when user messages intervene", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello", timestamp: "" },
      { id: "2", role: "assistant", content: "Hi", timestamp: "" },
      { id: "3", role: "assistant", content: "How can I help?", timestamp: "" },
      { id: "4", role: "user", content: "Search for files", timestamp: "" },
      { id: "5", role: "assistant", content: "Searching...", timestamp: "" },
      { id: "6", role: "assistant", content: "Done", timestamp: "" },
    ];

    const groups = groupChatMessages(messages);
    expect(groups).toHaveLength(4);
    expect(groups[0]).toMatchObject({ type: "messages", isUser: true, id: "1" });
    expect(groups[1]).toMatchObject({ type: "messages", isUser: false, id: "2" });
    expect(groups[2]).toMatchObject({ type: "messages", isUser: true, id: "4" });
    expect(groups[3]).toMatchObject({ type: "messages", isUser: false, id: "5" });

    if (groups[1].type === "messages") {
      expect(groups[1].messages.map((m) => m.id)).toEqual(["2", "3"]);
    }
    if (groups[3].type === "messages") {
      expect(groups[3].messages.map((m) => m.id)).toEqual(["5", "6"]);
    }
  });

  it("keeps console messages standalone without swallowing them into agent bubbles", () => {
    const messages: Message[] = [
      { id: "1", role: "assistant", content: "Thinking...", timestamp: "" },
      { id: "console-1", role: "console", content: "Subagent running", timestamp: "" },
      { id: "2", role: "assistant", content: "Result ready", timestamp: "" },
    ];

    const groups = groupChatMessages(messages);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ type: "messages", isUser: false, id: "1" });
    expect(groups[1]).toMatchObject({ type: "console" });
    expect(groups[2]).toMatchObject({ type: "messages", isUser: false, id: "2" });
  });

  it("handles empty messages array", () => {
    expect(groupChatMessages([])).toEqual([]);
  });
});

describe("Chat component rendering", () => {
  it("renders 5 consecutive agent messages under a single cloud with a single header", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const messages: Message[] = [
      { id: "m1", role: "assistant", content: "Analyzing workspace...", timestamp: "2026-09-20T10:00:00Z" },
      { id: "m2", role: "assistant", content: "Inspecting dependencies...", timestamp: "2026-09-20T10:00:05Z" },
      { id: "m3", role: "assistant", content: "Running lint check...", timestamp: "2026-09-20T10:00:10Z" },
      { id: "m4", role: "assistant", content: "Found 0 errors.", timestamp: "2026-09-20T10:00:15Z" },
      { id: "m5", role: "assistant", content: "Execution completed successfully.", timestamp: "2026-09-20T10:00:20Z" },
    ];

    const mount = document.createElement("div");
    const root = createRoot(mount);

    try {
      await act(async () => {
        root.render(<Chat messages={messages} />);
      });

      // Exactly 1 message cloud header
      const headers = mount.querySelectorAll("[class*='messageHeader']");
      expect(headers).toHaveLength(1);
      expect(headers[0].textContent).toContain("[AGENT]");
      expect(headers[0].textContent).toContain("Execution Result");

      // Exactly 1 message container (cloud)
      const messageContainers = mount.querySelectorAll("[class*='agentMessage']");
      expect(messageContainers).toHaveLength(1);

      // All 5 message texts are present inside the cloud
      expect(mount.textContent).toContain("Analyzing workspace...");
      expect(mount.textContent).toContain("Inspecting dependencies...");
      expect(mount.textContent).toContain("Running lint check...");
      expect(mount.textContent).toContain("Found 0 errors.");
      expect(mount.textContent).toContain("Execution completed successfully.");

      // 4 dividers between the 5 messages
      const dividers = mount.querySelectorAll("[data-testid='grouped-divider']");
      expect(dividers).toHaveLength(4);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("renders separate clouds when user and agent alternate", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const messages: Message[] = [
      { id: "u1", role: "user", content: "Can you fix the bug?", timestamp: "" },
      { id: "a1", role: "assistant", content: "Looking into it...", timestamp: "" },
      { id: "a2", role: "assistant", content: "Found the bug.", timestamp: "" },
      { id: "u2", role: "user", content: "Great, please apply it.", timestamp: "" },
      { id: "a3", role: "assistant", content: "Applied.", timestamp: "" },
    ];

    const mount = document.createElement("div");
    const root = createRoot(mount);

    try {
      await act(async () => {
        root.render(<Chat messages={messages} />);
      });

      const userContainers = mount.querySelectorAll("[class*='userMessage']");
      const agentContainers = mount.querySelectorAll("[class*='agentMessage']");

      expect(userContainers).toHaveLength(2);
      expect(agentContainers).toHaveLength(2);

      // The first agent container has 2 messages with 1 divider
      const firstAgentCloud = agentContainers[0];
      expect(firstAgentCloud.textContent).toContain("Looking into it...");
      expect(firstAgentCloud.textContent).toContain("Found the bug.");
      expect(firstAgentCloud.querySelectorAll("[data-testid='grouped-divider']")).toHaveLength(1);

      // The second agent container has 1 message with 0 dividers
      const secondAgentCloud = agentContainers[1];
      expect(secondAgentCloud.textContent).toContain("Applied.");
      expect(secondAgentCloud.querySelectorAll("[data-testid='grouped-divider']")).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
