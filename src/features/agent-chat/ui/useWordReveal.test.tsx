// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../chatTypes";
import { useWordReveal, WORD_REVEAL_TICK_MS as TICK } from "./useWordReveal";

function View({ text, live, chatKey = "chat" }: { text: string; live: boolean; chatKey?: string }) {
  const message: Message = { id: "answer", role: "assistant", content: text, timestamp: "" };
  const reveal = useWordReveal([message], live, true, chatKey);
  return <div data-revealing={reveal.revealing(message)}>{reveal.displayed(message)}</div>;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("word reveal", () => {
  it("reveals one complete word per tick and drains after completion", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<View text="One two thr" live />));
    expect(container.textContent).toBe("");
    await act(async () => vi.advanceTimersByTime(TICK));
    expect(container.textContent).toBe("One");
    await act(async () => vi.advanceTimersByTime(TICK));
    expect(container.textContent).toBe("One two");
    await act(async () => root.render(<View text="One two three four" live />));
    await act(async () => vi.advanceTimersByTime(TICK));
    expect(container.textContent).toBe("One two three");
    await act(async () => root.render(<View text="One two three four" live={false} />));
    expect(container.textContent).toBe("One two three");
    await act(async () => vi.advanceTimersByTime(TICK));
    expect(container.textContent).toBe("One two three four");
    expect(container.firstElementChild?.getAttribute("data-revealing")).toBe("false");
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the consumer clock running while batches arrive", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<View text="One two" live />));
    await act(async () => vi.advanceTimersByTime(TICK - 7));
    await act(async () => root.render(<View text="One two three" live />));
    await act(async () => vi.advanceTimersByTime(7));
    expect(container.textContent).toBe("One");
    await act(async () => root.unmount());
  });

  it("reveals about 50 words a second, over three times the old pace", () => {
    expect(TICK).toBeLessThanOrEqual(65 / 3);
  });

  it("catches up on a large backlog instead of trailing behind it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const words = Array.from({ length: 400 }, (_, index) => `w${index}`);
    await act(async () => root.render(<View text={`${words.join(" ")} tail`} live />));
    await act(async () => vi.advanceTimersByTime(TICK));
    // 400 words waiting: several are shown in one tick, not one.
    expect(container.textContent!.split(" ").length).toBeGreaterThan(5);
    // Within a second all of it is shown, except the word the model may still extend.
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toBe(words.join(" "));
    await act(async () => root.unmount());
  });

  it("restarts a replaced response without exposing its backlog", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<View text="Old words here" live />));
    await act(async () => vi.advanceTimersByTime(TICK));
    await act(async () => root.render(<View text="New words here" live />));
    expect(container.textContent).toBe("");
    await act(async () => vi.advanceTimersByTime(TICK));
    expect(container.textContent).toBe("New");
    await act(async () => root.unmount());
  });
});
