// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TOKEN_OPTIMIZATIONS,
  createCommandOutputCondenser,
  isOptimizationEnabled,
  resetTokenOptimizationStats,
  setOptimizationEnabled,
} from "../../../harness/core/tokenOptimizations";
import { TokenOptimizationSettings } from "./TokenOptimizationSettings";

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<TokenOptimizationSettings />));
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

afterEach(() => {
  for (const optimization of TOKEN_OPTIMIZATIONS) setOptimizationEnabled(optimization.id, true);
  resetTokenOptimizationStats();
});

describe("Token optimisations settings", () => {
  it("shows every optimisation with its explanation, the safeguards and an empty statistics card", async () => {
    resetTokenOptimizationStats();
    const view = await render();
    try {
      for (const optimization of TOKEN_OPTIMIZATIONS) {
        expect(view.container.textContent).toContain(optimization.name);
        expect(view.container.textContent).toContain(optimization.summary);
        expect(view.container.querySelector<HTMLInputElement>(`#token-optimization-${optimization.id}`)?.checked).toBe(true);
      }
      expect(view.container.textContent).toContain("Never worse");
      expect(view.container.textContent).toContain("Nothing condensed yet.");
    } finally {
      await view.unmount();
    }
  });

  it("turns an optimisation off from its switch", async () => {
    const view = await render();
    try {
      const toggle = view.container.querySelector<HTMLInputElement>("#token-optimization-stable-history")!;
      await act(async () => toggle.click());
      expect(isOptimizationEnabled("stable-history")).toBe(false);
      expect(toggle.checked).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it("lists what each filter saved and how often its output was read back", async () => {
    resetTokenOptimizationStats();
    const outputs = createCommandOutputCondenser();
    const log = Array.from({ length: 60 }, (_, i) => `commit ${String(i).padStart(7, "0")}abc\nAuthor: A <a@x>\nDate:   Fri Oct 30 17:31:56 2026 +0200\n\n    Subject ${i}\n`).join("\n");
    const { recallId } = outputs.condense({ program: "git", args: ["log"], exitCode: 0, output: log });
    outputs.recall(recallId!);
    const view = await render();
    try {
      const row = [...view.container.querySelectorAll("tr")].find((tr) => tr.textContent?.startsWith("git log"));
      expect(row?.textContent).toMatch(/^git log1[\d,]+[\d,]+\d+%1100%$/);
    } finally {
      await view.unmount();
    }
  });
});
