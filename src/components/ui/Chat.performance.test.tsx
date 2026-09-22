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
    await act(async () => root.render(<Chat messages={[{ id: "large", role: "assistant", content, timestamp: "" }]} />));
    expect(markdownRender).not.toHaveBeenCalled();
    expect(mount.querySelector("pre")?.textContent).toHaveLength(CHAT_PREVIEW_CHARS);
    await act(async () => mount.querySelector<HTMLButtonElement>("button")!.click());
    expect(mount.querySelector("pre")?.textContent).toBe(content);
    expect(markdownRender).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
