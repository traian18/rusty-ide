// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ContextEstimate } from "../../../harness/contract";
import { ContextMeter } from "./ContextMeter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const estimate = (usagePercent: number): ContextEstimate => ({
  model: "gpt-6.1-terra", estimatedInputTokens: 120_000, inputBudget: 441_808, modelWindow: 500_000,
  remainingInputTokens: 321_808, usagePercent,
});

let container: HTMLDivElement;
async function render(value: ContextEstimate | null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<ContextMeter estimate={value} />));
  return container;
}
afterEach(() => container.remove());

describe("ContextMeter", () => {
  it("shows nothing without an estimate", async () => {
    expect((await render(null)).innerHTML).toBe("");
  });

  it("is a meter with the percentage, described by the breakdown bubble", async () => {
    const view = await render(estimate(27.4));
    const meter = view.querySelector('[role="meter"]')!;
    expect(meter.getAttribute("aria-valuenow")).toBe("27");
    expect(meter.getAttribute("aria-label")).toBe("Context");
    expect(meter.textContent).toBe("27%");
    const bubble = view.querySelector(`#${meter.getAttribute("aria-describedby")}`)!;
    expect(bubble.getAttribute("role")).toBe("tooltip");
    expect(bubble.textContent).toContain("Context27% used");
    expect(bubble.textContent).toContain("Used120,000");
    expect(bubble.textContent).toContain("Remaining321,808");
    expect(bubble.textContent).toContain("Model window500,000");
    expect(bubble.textContent).toContain("gpt-6.1-terra");
  });

  it("changes level where summaries start and where compaction runs", async () => {
    const levelAt = async (percent: number) => (await render(estimate(percent))).querySelector('[role="meter"]')!.getAttribute("data-level");
    expect(await levelAt(69)).toBe("ok");
    expect(await levelAt(70)).toBe("warn");
    expect(await levelAt(85)).toBe("full");
    // Over budget still draws a full bar, not an overflowing one.
    expect((await render(estimate(130))).querySelector('[role="meter"]')!.getAttribute("aria-valuenow")).toBe("100");
  });
});
