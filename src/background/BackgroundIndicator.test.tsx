// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackgroundIndicator } from "./BackgroundIndicator";
import { useBackground } from "./backgroundStore";
import type { Job } from "./client";

let container: HTMLDivElement;
let root: Root;
const job = (overrides: Partial<Job>): Job => ({ id: 1, kind: "analysis", root: "/r", label: "Analysing r", detail: null, done: null, total: null, state: "running", message: null, ...overrides });
const button = () => container.querySelector("button");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useBackground.setState({ jobs: [], questions: [], open: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("BackgroundIndicator", () => {
  it("draws nothing when there is nothing in the background", async () => {
    await act(async () => root.render(<BackgroundIndicator />));
    expect(button()).toBeNull();
  });

  it("spins with the number of processes in the middle and toggles the bubbles", async () => {
    useBackground.setState({ jobs: [job({}), job({ id: 2, state: "finished" })] });
    await act(async () => root.render(<BackgroundIndicator />));
    expect(button()!.textContent).toBe("2");
    expect(button()!.getAttribute("data-state")).toBe("running");
    expect(container.querySelector("[data-spinning]")).not.toBeNull();
    expect(button()!.getAttribute("aria-label")).toContain("1 running");
    await act(async () => button()!.click());
    expect(useBackground.getState().open).toBe(true);
    expect(button()!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button()!.click());
    expect(useBackground.getState().open).toBe(false);
  });

  it("stops spinning when nothing runs and marks a failure", async () => {
    useBackground.setState({ jobs: [job({ state: "failed", message: "no model" })] });
    await act(async () => root.render(<BackgroundIndicator />));
    expect(container.querySelector("[data-spinning]")).toBeNull();
    expect(button()!.getAttribute("data-state")).toBe("failed");
  });
});
