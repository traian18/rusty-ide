// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Chat, type Message } from "./Chat";
import { CHAT_PREVIEW_CHARS } from "./ChatMessageContent";

const { markdownRender } = vi.hoisted(() => ({ markdownRender: vi.fn() }));
vi.mock("./MarkdownRenderer", async () => {
  const { memo } = await import("react");
  return { MarkdownRenderer: memo(({ content }: { content: string }) => { markdownRender(content); return <div>{content}</div>; }) };
});
vi.mock("../../store", () => {
  const state = { rootPath: "/ws", openTab: vi.fn() };
  return { useWorkspaceStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

it("typing does not reparse completed messages, and stream updates do not parse Markdown", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  markdownRender.mockClear();
  const messages: Message[] = [{ id: "old", role: "assistant", content: "Existing findings", timestamp: "" }];
  let changeDraft!: (value: string) => void;
  let addTokens!: (value: Message[]) => void;
  function Host() {
    const [draft, setDraft] = useState("");
    const [chat, setChat] = useState(messages);
    changeDraft = setDraft; addTokens = setChat;
    return <><input value={draft} onChange={(event) => setDraft(event.target.value)} /><Chat messages={chat} isStreaming={chat.length > 1} /></>;
  }
  const mount = document.createElement("div");
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<Host />));
    expect(markdownRender).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) await act(async () => changeDraft(`prompt ${i}`));
    expect(markdownRender).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) await act(async () => addTokens([...messages, {
      id: "live", role: "assistant", content: `| incomplete table ${i}`, timestamp: "",
    }]));
    expect(markdownRender).toHaveBeenCalledTimes(1);
    expect(mount.textContent).toContain("incomplete table 9");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("bounds rendering of a large saved response without removing the full text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  markdownRender.mockClear();
  const mount = document.createElement("div");
  const root = createRoot(mount);
  const content = "| garbled table |".repeat(4000);
  try {
    const needleStart = content.indexOf("garbled");
    const searchMatches = [{ messageId: "large", messageIndex: 0, occurrence: 0, start: needleStart, end: needleStart + "garbled".length }];
    await act(async () => root.render(<Chat messages={[{ id: "large", role: "assistant", content, timestamp: "" }]} searchMatches={searchMatches} />));
    expect(markdownRender).not.toHaveBeenCalled();
    expect(mount.querySelector("pre")?.textContent).toHaveLength(CHAT_PREVIEW_CHARS);
    expect(mount.querySelectorAll('[data-testid="chat-search-highlight"]')).toHaveLength(1);
    await act(async () => mount.querySelector<HTMLButtonElement>("button")!.click());
    expect(mount.querySelector("pre")?.textContent).toBe(content);
    expect(mount.querySelectorAll('[data-testid="chat-search-highlight"]')).toHaveLength(1);
    expect(markdownRender).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("keeps showing the live end of a streamed response longer than the render limit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  const root = createRoot(mount);
  const line = (n: number) => `line ${n} ${"x".repeat(40)}\n`;
  let content = "";
  let n = 0;
  while (content.length < CHAT_PREVIEW_CHARS * 1.6) content += line(n++);
  const lastLine = `line ${n - 1} `;
  try {
    const needleStart = content.indexOf("line 0");
    const searchMatches = [{ messageId: "live", messageIndex: 1, occurrence: 0, start: needleStart, end: needleStart + "line 0".length }];
    await act(async () => root.render(<Chat messages={[
      { id: "q", role: "user", content: "write a lot", timestamp: "" },
      { id: "live", role: "assistant", content, timestamp: "" },
    ]} isStreaming searchMatches={searchMatches} />));
    const shown = mount.querySelector("pre")!.textContent!;
    expect(content.length).toBeGreaterThan(50_000);
    expect(shown).toContain(lastLine);
    expect(shown.length).toBeLessThanOrEqual(CHAT_PREVIEW_CHARS);
    expect(shown.startsWith("line ")).toBe(true);
    expect(mount.textContent).toContain(`Long response: ${content.length.toLocaleString()} characters so far`);
    expect(mount.querySelectorAll('[data-testid="chat-search-highlight"]')).toHaveLength(0);

    const visibleStart = content.indexOf(lastLine);
    const liveMatch = [{ messageId: "live", messageIndex: 1, occurrence: 0, start: visibleStart, end: visibleStart + lastLine.length }];
    await act(async () => root.render(<Chat messages={[
      { id: "q", role: "user", content: "write a lot", timestamp: "" },
      { id: "live", role: "assistant", content, timestamp: "" },
    ]} isStreaming searchMatches={liveMatch} />));
    expect(mount.querySelectorAll('[data-testid="chat-search-highlight"]')).toHaveLength(1);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("renders responses up to double the previous 16k limit as Markdown", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  markdownRender.mockClear();
  const mount = document.createElement("div");
  const root = createRoot(mount);
  const content = "word ".repeat(6_000); // 30,000 characters
  try {
    await act(async () => root.render(<Chat messages={[{ id: "done", role: "assistant", content, timestamp: "" }]} />));
    expect(CHAT_PREVIEW_CHARS).toBeGreaterThanOrEqual(32_000);
    expect(markdownRender).toHaveBeenCalledWith(content);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
