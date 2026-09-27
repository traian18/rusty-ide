// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useWorkspaceStore } from "../../store";
import { MetricsTab } from "./MetricsTab";

const today = new Date().toISOString().slice(0, 10);
const totals = (totalTokens: number, calls: number) => ({ input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens, calls });

describe("MetricsTab day reset", () => {
  let summary: unknown;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    summary = {
      byDay: { [today]: { byModel: { "gpt-4o": totals(900, 3), "selector-mini": totals(100, 2) }, total: totals(1000, 5) } },
      allTime: { byModel: { "gpt-4o": totals(900, 3), "selector-mini": totals(100, 2) }, total: totals(1000, 5) },
    };
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === "read_file_disk") return JSON.stringify(summary);
      if (command === "reset_usage_day") {
        summary = { ...(summary as object), byDay: {} };
        return undefined;
      }
      throw new Error(`unexpected command ${command}`);
    });
    useWorkspaceStore.setState({ rootPath: "/ws" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<MetricsTab />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows smart-tool models alongside run models", () => {
    expect(container.textContent).toContain("gpt-4o");
    expect(container.textContent).toContain("selector-mini");
    expect(container.textContent).toContain("Model requests");
  });

  it("resets the selected day to zero only after confirmation", async () => {
    await act(async () => {
      document.querySelector<HTMLButtonElement>("#metrics-reset-day")!.click();
    });
    expect(document.body.textContent).toContain(`Reset token usage for ${today}?`);

    await act(async () => {
      document.querySelector<HTMLButtonElement>("#confirm-modal-confirm")!.click();
    });

    expect(invoke).toHaveBeenCalledWith("reset_usage_day", { workspaceRoot: "/ws", day: today });
    expect(useWorkspaceStore.getState().metricsTodayTotal).toBe(0);
    expect(container.textContent).toContain("No token usage recorded yet for this period.");
    expect(container.querySelector("#metrics-reset-day")).toBeNull();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    await act(async () => {
      document.querySelector<HTMLButtonElement>("#metrics-reset-day")!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("#confirm-modal-cancel")!.click();
    });
    expect(invoke).not.toHaveBeenCalledWith("reset_usage_day", expect.anything());
    expect(container.textContent).toContain("gpt-4o");
  });
});
