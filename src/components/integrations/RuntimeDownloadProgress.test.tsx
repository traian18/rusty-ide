// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeDownloadProgress, type RuntimeProgress } from "./RuntimeDownloadProgress";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

let root: Root;
let container: HTMLDivElement;
let receive: (event: { payload: RuntimeProgress }) => void;
const progress: RuntimeProgress = {
  provider: "codex", phase: "downloading", downloaded: 25 * 1024 * 1024,
  total: 100 * 1024 * 1024, message: null,
};
const send = async (payload: RuntimeProgress) => {
  await act(async () => receive({ payload }));
};

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.stop.mockReset();
  mocks.listen.mockImplementation(async (_event, handler) => {
    receive = handler;
    return mocks.stop;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<RuntimeDownloadProgress />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("runtime download progress", () => {
  it("shows actual bytes and percentage, then installation and completion", async () => {
    await send(progress);
    expect(container.textContent).toContain("25%");
    expect(container.textContent).toContain("25.0 MB of 100.0 MB");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("25");
    await send({ ...progress, phase: "installing" });
    expect(container.textContent).toContain("Verifying and installing SDK");
    expect(container.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
    await send({ ...progress, phase: "complete" });
    expect(container.textContent).toContain("SDK ready");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("section")).toBeNull();
  });

  it("handles unknown sizes, separate providers, cancellation, failure, and retry", async () => {
    await send({ ...progress, total: null });
    expect(container.textContent).toContain("25.0 MB downloaded");
    expect(container.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
    await send({ ...progress, provider: "claude-code" });
    expect(container.querySelectorAll("section")).toHaveLength(2);
    await send({ ...progress, phase: "cancelled" });
    expect(container.textContent).toContain("Download cancelled");
    await send({ ...progress, provider: "claude-code", phase: "failed", message: "Connection lost. Retry sign-in." });
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Connection lost");
    await send({ ...progress, downloaded: 0 });
    expect(container.textContent).toContain("0%");
    expect(container.querySelectorAll("section")).toHaveLength(2);
  });
});
