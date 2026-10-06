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

const makeFixture = (count: number): Message[] => Array.from({ length: count }, (_, index): Message => ({
  id: `fixture-${index}`,
  role: index % 2 === 0 ? "user" : "assistant",
  content: `fixture message ${index} searchable ${index % 3 === 0 ? "needle" : ""}`,
  timestamp: "",
}));

it("coalesces native scroll events and follows the fallback window", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const metrics = vi.fn();
  const mount = document.createElement("div");
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<Chat messages={makeFixture(2048)} onPerformanceMetrics={metrics} onVisibleMessageChange={vi.fn()} />));
    const container = mount.querySelector<HTMLElement>(".overflow-y-auto")!;
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 2048 * 40 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    const elements = [...mount.querySelectorAll<HTMLElement>("[data-message-id]")];
    const reads = elements.map((element) => vi.spyOn(element, "getBoundingClientRect"));
    container.dispatchEvent(new Event("scroll"));
    container.dispatchEvent(new Event("scroll"));
    expect(frames).toHaveLength(1);
    await act(async () => frames.shift()!(0));
    const firstScan = metrics.mock.calls.at(-1)?.[0];
    expect(firstScan.geometryReads).toBeLessThanOrEqual(64);
    const firstReads = reads.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    Object.defineProperty(container, "scrollTop", { configurable: true, writable: true, value: 2048 * 40 - 600 });
    container.dispatchEvent(new Event("scroll"));
    await act(async () => frames.shift()!(0));
    const secondReads = reads.reduce((sum, spy) => sum + spy.mock.calls.length, 0) - firstReads;
    expect(secondReads).toBeLessThanOrEqual(64);
    expect(metrics.mock.calls.at(-1)?.[0].visibilityScans).toBe(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("uses IntersectionObserver candidates and cleans them up", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const observed: Element[] = [];
  const entries: Array<{ target: Element; isIntersecting: boolean }> = [];
  let callback: IntersectionObserverCallback | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(next: IntersectionObserverCallback) { callback = next; }
    observe(element: Element) { observed.push(element); }
    disconnect() { disconnect(); }
  });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => { frames.push(next); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const mount = document.createElement("div");
  const root = createRoot(mount);
  const visible = vi.fn();
  try {
    await act(async () => root.render(<Chat messages={makeFixture(128)} onVisibleMessageChange={visible} />));
    expect(observed.length).toBe(128);
    const first = observed[0];
    callback?.([{ target: first, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    const container = mount.querySelector<HTMLElement>(".overflow-y-auto")!;
    Object.defineProperties(container, { clientHeight: { configurable: true, value: 600 }, scrollHeight: { configurable: true, value: 5120 }, scrollTop: { configurable: true, writable: true, value: 0 } });
    container.dispatchEvent(new Event("scroll"));
    await act(async () => frames.shift()?.(0));
    expect(visible).toHaveBeenCalledWith("fixture-0");
  } finally {
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  }
});

it("measures bounded visibility work for deterministic chat fixtures", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  const metrics = vi.fn();
  const mount = document.createElement("div");
  const root = createRoot(mount);
  try {
    for (const count of [32, 256, 2048]) {
      await act(async () => root.render(<Chat messages={makeFixture(count)} onPerformanceMetrics={metrics} onVisibleMessageChange={vi.fn()} />));
      const container = mount.querySelector<HTMLElement>(".overflow-y-auto")!;
      Object.defineProperty(container, "clientHeight", { configurable: true, value: 600 });
      Object.defineProperty(container, "scrollHeight", { configurable: true, value: count * 40 });
      container.dispatchEvent(new Event("scroll"));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    const latest = metrics.mock.calls.at(-1)?.[0];
    expect(latest.visibilityScans).toBeGreaterThan(0);
    expect(latest.geometryReads).toBeLessThanOrEqual(latest.visibilityScans * 64);
    expect(latest.scrollEvents).toBeGreaterThan(0);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it("coalesces follow-latest writes from message and resize updates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const resizeCallbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); } observe() {} disconnect() {} });
  const metrics = vi.fn();
  const mount = document.createElement("div");
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<Chat followLatest onPerformanceMetrics={metrics} messages={makeFixture(32)} />));
    const container = mount.querySelector<HTMLElement>(".overflow-y-auto")!;
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    resizeCallbacks[0]?.([], {} as ResizeObserver);
    resizeCallbacks[0]?.([], {} as ResizeObserver);
    expect(frames.length).toBe(1);
    await act(async () => frames.shift()!(0));
    expect(container.scrollTop).toBe(1000);
    expect(metrics.mock.calls.at(-1)?.[0].followLatestWrites).toBe(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("reports jump latency after the scheduled alignment completes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  const metrics = vi.fn();
  const mount = document.createElement("div");
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<Chat messages={makeFixture(32)} explicitScrollTarget={{ messageId: "fixture-10", token: 2 }} onPerformanceMetrics={metrics} />));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(metrics.mock.calls.at(-1)?.[0].jumpLatencyMs).toBeUndefined();
    await act(async () => { frames.shift()!(0); });
    await act(async () => { frames.shift()!(16); });
    const completedMetric = metrics.mock.calls.map(([value]) => value).find((value) => value.jumpLatencyMs !== undefined);
    expect(completedMetric?.jumpLatencyMs).toBeGreaterThanOrEqual(0);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
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
