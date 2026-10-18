// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBackground } from "./backgroundStore";
import type { Job } from "./client";
import { FINISHED_VISIBLE_MS, ProcessBubble } from "./ProcessBubble";

let container: HTMLDivElement;
let root: Root;
const job = (overrides: Partial<Job>): Job => ({ id: 1, kind: "analysis", root: "/r", label: "Analysing r", detail: "Reading the code", done: 1, total: 2, state: "running", message: null, ...overrides });
const buttons = () => [...container.querySelectorAll("button")] as HTMLButtonElement[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useBackground.setState({ jobs: [], questions: [] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProcessBubble", () => {
  it("shows nothing when nothing runs", async () => {
    await act(async () => root.render(<ProcessBubble client={{ cancel: vi.fn() }} />));
    expect(container.textContent).toBe("");
  });

  it("lists each job with its progress and its own stop button", async () => {
    const cancel = vi.fn(async () => undefined);
    useBackground.setState({ jobs: [job({}), job({ id: 2, kind: "documentation", label: "Updating documentation of r", detail: "Writing Overview", done: null, total: null })] });
    await act(async () => root.render(<ProcessBubble client={{ cancel }} />));
    expect(container.textContent).toContain("Reading the code");
    expect(container.querySelector('[role="progressbar"][aria-valuenow="50"]')).not.toBeNull();
    expect(container.textContent).toContain("Writing Overview");
    await act(async () => buttons().find((b) => b.getAttribute("aria-label") === "Stop Updating documentation of r")!.click());
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it("lets finished jobs go after a moment and keeps failures until dismissed", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    useBackground.setState({ jobs: [job({ state: "finished" }), job({ id: 3, state: "failed", message: "no model" })] });
    await act(async () => root.render(<ProcessBubble client={{ cancel }} />));
    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("no model");
    await act(async () => vi.advanceTimersByTime(FINISHED_VISIBLE_MS));
    expect(cancel).toHaveBeenCalledWith(1);
    expect(cancel).not.toHaveBeenCalledWith(3);
  });

  it("asks questions and runs the accepted action", async () => {
    const onAccept = vi.fn();
    useBackground.getState().ask({ id: "q", title: "Update the documentation?", message: "Your commit changed 2 files.", accept: "Update", onAccept });
    await act(async () => root.render(<ProcessBubble client={{ cancel: vi.fn() }} />));
    expect(container.textContent).toContain("Your commit changed 2 files.");
    await act(async () => buttons().find((b) => b.textContent === "Update")!.click());
    expect(onAccept).toHaveBeenCalled();
    expect(useBackground.getState().questions).toEqual([]);
  });
});
