// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chat, type Message } from "./Chat";
import { groupAgentTurns, processSummary, processTimeline, turnAnswer } from "./AgentTurn";
import { StreamingMarkdown, splitMarkdownBlocks } from "./StreamingMarkdown";

vi.mock("../../store", () => {
  const state = { rootPath: "/ws", openTab: vi.fn() };
  return { useWorkspaceStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 13, 12, 0, seconds)).toISOString();
const turn: Message[] = [
  { id: "u1", role: "user", content: "fix the bug", timestamp: at(0) },
  {
    id: "c1", role: "console", content: "", timestamp: at(0),
    activityEntries: [
      { content: "Calling read_file...", kind: "tool", at: Date.parse(at(2)) },
      { content: "Calling edit_file...", kind: "tool", at: Date.parse(at(5)) },
    ],
  },
  { id: "a1", role: "assistant", content: "Reading the parser first.", timestamp: at(1) },
  { id: "a2", role: "assistant", content: "Now patching it.", timestamp: at(4) },
  { id: "a3", role: "assistant", content: "Fixed: the parser now handles empty input.", timestamp: at(6) },
];

async function mount(render: (root: ReturnType<typeof createRoot>) => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => render(root));
  return { container, root };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agent turns", () => {
  it("groups everything after a user message into one turn", () => {
    const items = groupAgentTurns(turn);
    expect(items.map((item) => item.type)).toEqual(["user", "turn"]);
    expect(items[1].type === "turn" && items[1].messages.map((message) => message.id)).toEqual(["c1", "a1", "a2", "a3"]);
    expect(turnAnswer(turn.slice(1))?.id).toBe("a3");
  });

  it("interleaves model messages and tool activity in the order they happened", () => {
    const steps = processTimeline(turn.slice(1, 4));
    expect(steps.map((step) => step.type === "text" ? step.message.id : step.entry.content)).toEqual([
      "a1", "Calling read_file...", "a2", "Calling edit_file...",
    ]);
    expect(processSummary(steps)).toBe("2 tool calls · 2 messages");
  });

  it("keeps all work in the balloon while live, then folds it away and leaves the answer large", async () => {
    vi.useFakeTimers();
    const { container, root } = await mount((root) => root.render(<Chat messages={turn} isStreaming streamingLabel="Generating response…" turnLayout />));

    expect(container.querySelector('[data-testid="agent-turn-answer"]')).toBeNull();
    const process = container.querySelector('[data-testid="agent-turn-process"]')!;
    expect(process.textContent).toContain("Generating response…");
    expect(process.textContent).toContain("Fixed: the parser now handles empty input.");
    expect(container.querySelector('[data-testid="agent-turn-toggle"]')?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => root.render(<Chat messages={turn} turnLayout />));
    await act(async () => { vi.advanceTimersByTime(400); });

    const answer = container.querySelector('[data-testid="agent-turn-answer"]')!;
    expect(answer.textContent).toContain("Fixed: the parser now handles empty input.");
    expect(container.querySelector('[data-testid="agent-turn-toggle"]')?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="agent-activity-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-turn-toggle"]')?.textContent).toContain("2 tool calls · 2 messages");

    // The steps can still be inspected.
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="agent-turn-toggle"]')!.click());
    expect(container.querySelector('[data-testid="agent-activity-list"]')?.textContent).toContain("Now patching it.");
    await act(async () => root.unmount());
  });

  it("shows a reply without tool work as the answer alone", async () => {
    const { container, root } = await mount((root) => root.render(<Chat turnLayout messages={[
      { id: "u", role: "user", content: "hi", timestamp: "" },
      { id: "a", role: "assistant", content: "Hello!", timestamp: "" },
    ]} />));
    expect(container.querySelector('[data-testid="agent-turn-process"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-turn-answer"]')?.textContent).toContain("Hello!");
    await act(async () => root.unmount());
  });

  it("opens a folded turn when a search finding sits inside its process", async () => {
    const { container, root } = await mount((root) => root.render(<Chat messages={turn} turnLayout />));
    expect(container.querySelector("[data-message-id='a2']")).toBeNull();
    await act(async () => root.render(<Chat messages={turn} turnLayout activeMessageId="a2" />));
    expect(container.querySelector("[data-message-id='a2']")).not.toBeNull();
    await act(async () => root.unmount());
  });
});

describe("streaming Markdown", () => {
  it("splits at blank lines, but never inside a code fence or before an indented continuation", () => {
    const content = "Intro line\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n- item\n\n  continued\n\nLast";
    expect(splitMarkdownBlocks(content).map((block) => block.text)).toEqual([
      "Intro line",
      "```ts\nconst a = 1;\n\nconst b = 2;\n```",
      "- item\n\n  continued",
      "Last",
    ]);
    for (const block of splitMarkdownBlocks(content)) expect(content.slice(block.start, block.start + block.text.length)).toBe(block.text);
  });

  it("renders Markdown as it arrives and wraps new words so they fade in", async () => {
    const { container, root } = await mount((root) => root.render(<StreamingMarkdown content="Hello" />));
    await act(async () => root.render(<StreamingMarkdown content={"Hello **there** world\n\n- one\n- two"} />));
    expect(container.querySelector("strong")?.textContent).toBe("there");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).not.toContain("**");
    const words = [...container.querySelectorAll<HTMLSpanElement>("span")].map((span) => span.textContent);
    expect(words).toEqual(["Hello", "there", "world", "one", "two"]);
    // Each batch staggers its words within a block: "Hello" came first, the rest in the second update.
    const delays = [...container.querySelectorAll<HTMLSpanElement>("span")].map((span) => span.style.animationDelay);
    expect(delays).toEqual(["0ms", "0ms", "24ms", "0ms", "24ms"]);
    await act(async () => root.unmount());
  });

  it("streams an agent answer as Markdown, not raw text", async () => {
    const { container, root } = await mount((root) => root.render(<Chat turnLayout isStreaming streamingMessageId="c" messages={[
      { id: "u", role: "user", content: "go", timestamp: "" },
      { id: "c", role: "console", content: "", timestamp: "" },
      { id: "a", role: "assistant", content: "Done with `cargo test`", timestamp: "" },
    ]} />));
    expect(container.querySelector("[data-message-id='a'] code")?.textContent).toBe("cargo test");
    expect(container.querySelector("[data-message-id='a'] pre")).toBeNull();
    await act(async () => root.unmount());
  });
});
