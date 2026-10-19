// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { PlanPanel } from "./PlanPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(plan: Parameters<typeof PlanPanel>[0]["plan"]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<PlanPanel plan={plan} />));
  return container;
}

describe("PlanPanel", () => {
  it("renders nothing without a plan", async () => {
    expect((await render([])).innerHTML).toBe("");
  });

  it("lists items, minimizes to a bar and expands again", async () => {
    const c = await render([
      { content: "Add endpoint", status: "completed" },
      { content: "Write tests", status: "in_progress" },
    ]);
    expect(c.textContent).toContain("Add endpoint");
    expect(c.textContent).toContain("1/2");

    await act(async () => c.querySelector<HTMLButtonElement>("[aria-label='Minimize plan']")!.click());
    expect(c.textContent).not.toContain("Write tests");
    const bar = c.querySelector<HTMLButtonElement>("[title='Show plan']")!;
    expect(bar.textContent).toContain("1/2");

    await act(async () => bar.click());
    expect(c.textContent).toContain("Write tests");
  });
});
