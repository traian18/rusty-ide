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

  it("groups messages correctly respecting phase field", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: "Hello", timestamp: "", phase: "query" },
      { id: "a1", role: "assistant", content: "Hi", timestamp: "", phase: "activity" },
      { id: "a2", role: "assistant", content: "Processing", timestamp: "", phase: "activity" },
      { id: "a3", role: "assistant", content: "Done", timestamp: "", phase: "response" },
    ];

    const groups = groupChatMessages(messages);
    expect(groups).toHaveLength(3);
    expect(groups[0].phase).toBe("query");
    if (groups[1].type === "messages") {
      expect(groups[1].messages).toHaveLength(2);  // a1, a2 grouped (same phase)
      expect(groups[1].phase).toBe("activity");
    }
    expect(groups[2].phase).toBe("response");  // Separate (different phase)
  });

  it("defaults phase to 'activity' for old messages without phase field", () => {
    const messages: Message[] = [
      { id: "1", role: "assistant", content: "Old message", timestamp: "" },  // No phase
    ];

    const groups = groupChatMessages(messages);
    expect(groups[0].phase).toBe("activity");  // Should default
  });
});

describe("Chat component rendering", () => {
  it("renders 5 consecutive agent messages under a single cloud with a single header", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const messages: Message[] = [
      { id: "m1", role: "assistant", content: "Analyzing workspace...", timestamp: "2026-09-20T10:00:00Z", phase: "response" },
      { id: "m2", role: "assistant", content: "Inspecting dependencies...", timestamp: "2026-09-20T10:00:05Z", phase: "response" },
      { id: "m3", role: "assistant", content: "Running lint check...", timestamp: "2026-09-20T10:00:10Z", phase: "response" },
      { id: "m4", role: "assistant", content: "Found 0 errors.", timestamp: "2026-09-20T10:00:15Z", phase: "response" },
      { id: "m5", role: "assistant", content: "Execution completed successfully.", timestamp: "2026-09-20T10:00:20Z", phase: "response" },
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
      expect(headers[0].textContent).toContain("Response");

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

  it("renders every typed activity entry in an accessible scroll region", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const entries = Array.from({ length: 30 }, (_, index) => ({
      content: `activity ${index + 1}`,
      kind: index % 2 === 0 ? "tool" as const : "update" as const,
    }));
    const mount = document.createElement("div");
    const root = createRoot(mount);

    try {
      await act(async () => {
        root.render(<Chat messages={[{
          id: "console", role: "console", content: entries.map((entry) => entry.content).join("\n"),
          activityEntries: entries, timestamp: "", phase: "activity",
        }]} />);
      });

      const list = mount.querySelector('[data-testid="agent-activity-list"]');
      expect(list?.getAttribute("aria-label")).toBe("Agent activity messages");
      expect(list?.getAttribute("tabindex")).toBe("0");
      expect(mount.textContent).not.toContain("last 25 of 30");
      const renderedEntries = [...(list?.querySelectorAll("[data-activity-kind]") || [])].map((entry) => entry.textContent);
      expect(renderedEntries).toContain("activity 1");
      expect(renderedEntries).toContain("activity 6");
      expect(renderedEntries).toContain("activity 30");
      expect(list?.querySelectorAll('[data-activity-kind="tool"]')).toHaveLength(15);
      expect(list?.querySelectorAll('[data-activity-kind="update"]')).toHaveLength(15);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("keeps activity pinned to the bottom until the user scrolls away", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const mount = document.createElement("div");
    const root = createRoot(mount);
    const createMessage = (count: number): Message => ({
      id: "console",
      role: "console",
      content: Array.from({ length: count }, (_, index) => `activity ${index + 1}`).join("\n"),
      activityEntries: Array.from({ length: count }, (_, index) => ({ content: `activity ${index + 1}`, kind: "tool" as const })),
      timestamp: "",
      phase: "activity",
    });

    try {
      await act(async () => {
        root.render(<Chat messages={[createMessage(25)]} />);
      });

      const list = mount.querySelector<HTMLElement>('[data-testid="agent-activity-list"]');
      expect(list).not.toBeNull();
      Object.defineProperties(list!, {
        clientHeight: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: 300 },
        scrollTop: { configurable: true, writable: true, value: 0 },
      });

      await act(async () => {
        root.render(<Chat messages={[createMessage(26)]} />);
      });
      expect(list!.scrollTop).toBe(300);

      list!.scrollTop = 50;
      list!.dispatchEvent(new Event("scroll", { bubbles: true }));
      await act(async () => {
        root.render(<Chat messages={[createMessage(27)]} />);
      });
      expect(list!.scrollTop).toBe(50);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("renders legacy activity content as default tool activity", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const mount = document.createElement("div");
    const root = createRoot(mount);

    try {
      await act(async () => {
        root.render(<Chat messages={[{ id: "console", role: "console", content: "legacy log", timestamp: "" }]} />);
      });
      expect(mount.querySelector('[data-activity-kind="tool"]')?.textContent).toBe("legacy log");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("scrolls to explicit targets and suppresses follow-latest after navigation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const scrollIntoView = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const mount = document.createElement("div");
    const root = createRoot(mount);
    const messages: Message[] = [
      { id: "u1", role: "user", content: "first", timestamp: "" },
      { id: "a1", role: "assistant", content: "answer", timestamp: "" },
    ];

    try {
      await act(async () => root.render(
        <Chat
          messages={messages}
          followLatest
          explicitScrollTarget={{ messageId: "u1", token: 1 }}
        />,
      ));
      const target = mount.querySelector<HTMLElement>("[data-message-id='u1']");
      expect(target).not.toBeNull();
      await act(async () => root.render(
        <Chat
          messages={[...messages, { id: "a2", role: "assistant", content: "streaming update", timestamp: "" }]}
          followLatest
          explicitScrollTarget={{ messageId: "u1", token: 1 }}
        />,
      ));
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("handles missing explicit targets without throwing", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const mount = document.createElement("div");
    const root = createRoot(mount);
    const handled = vi.fn();

    try {
      await act(async () => root.render(
        <Chat
          messages={[]}
          explicitScrollTarget={{ messageId: "missing", token: 1 }}
          onScrollTargetHandled={handled}
        />,
      ));
      expect(handled).toHaveBeenCalledWith("missing");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
