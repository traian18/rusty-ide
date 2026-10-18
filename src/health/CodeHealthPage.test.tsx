// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodeHealthPage } from "./CodeHealthPage";
import { fakeHealthClient, report } from "./health.testing";
import { bandOf } from "./model";

let container: HTMLDivElement;
let root: Root;
const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const all = (tag: string) => [...container.querySelectorAll(tag)] as HTMLElement[];
const byText = (text: string, tag = "button") => all(tag).find((e) => e.textContent?.trim() === text) ?? all(tag).find((e) => e.textContent?.includes(text));
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await settle();
};
const mount = async (client = fakeHealthClient(), openFile = vi.fn()) => {
  await act(async () => root.render(<CodeHealthPage client={client} root="/r" revision={1} openFile={openFile} />));
  await settle();
  return { client, openFile };
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("CodeHealthPage", () => {
  it("leads with the score, its band and what it rests on", async () => {
    await mount();
    const text = container.textContent!;
    for (const part of ["6.4", "of 10", "Fair", "7.3", "maintainability", "5.1", "hotspot health", "lowest: src/tangled.rs", "75%", "rust, typescript", "1 in other languages"]) {
      expect(text).toContain(part);
    }
    // The two explanations stay folded behind buttons until asked for.
    expect(text).not.toContain("not from a linter");
    await click(byText("How scores work"));
    expect(container.querySelector('[role="dialog"][aria-label="How scores work"]')!.textContent).toContain("not from a linter");
    // A press anywhere else closes it, as a real click does (it starts with mousedown).
    const other = byText("Self-check")!;
    await act(async () => other.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    await click(other);
    expect(container.querySelector('[role="dialog"][aria-label="How scores work"]')).toBeNull();
    expect(container.querySelector('[role="dialog"][aria-label="Self-check"]')!.textContent).toContain("Self-check unavailable");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-label="Distribution"]')!.textContent).toContain("At risk: 1 files, 50% of the code");
  });

  it("lists files worst first, filters them, and opens one in the drawer", async () => {
    const { client } = await mount();
    const rows = all("tbody tr").map((r) => r.querySelector("td")!.textContent);
    expect(rows[0]).toContain("src/tangled.rs");
    expect(container.textContent).toContain("not scored");
    const band = container.querySelector('select[aria-label="Band"]') as HTMLSelectElement;
    await act(async () => {
      band.value = "excellent";
      band.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(all("tbody tr").map((r) => r.querySelector("td")!.textContent)).toEqual(["web/a.ts"]);
    await click(byText("lowest: src/tangled.rs"));
    expect(client.file).toHaveBeenCalledWith("/r", "src/tangled.rs");
    expect(container.querySelector('aside[aria-label="Health of src/tangled.rs"]')).not.toBeNull();
  });

  it("groups issues by kind and folders by health", async () => {
    const { client } = await mount();
    await click(byText("Issues (4)"));
    await click(byText("Nested complexity"));
    await click(byText("src/tangled.rs"));
    expect(client.file).toHaveBeenCalledWith("/r", "src/tangled.rs");
    await click(byText("Folders"));
    expect(container.querySelector('table[aria-label="Folders"]')!.textContent).toContain("Needs work");
  });

  it("shows the self-check when there is enough history", async () => {
    const withCheck = { ...report(), selfCheck: { examined: 20, fixed_among_worst: 5, files: 30, fixed_files: 6, precision_per_mille: 250, base_rate_per_mille: 200, lift: 1.25, recall_per_mille: 833, window_days: 180, worst: [], note: "An association, not a prediction." } };
    await mount(fakeHealthClient({ report: vi.fn(async () => withCheck) as never }));
    await click(byText("Self-check"));
    expect(container.querySelector('[role="dialog"][aria-label="Self-check"]')!.textContent).toContain("5 of the 20 lowest-scoring files were bug-fixed in the last 180 days, against 20% of all files (1.25× the base rate)");
  });

  it("reports a failure instead of an empty page", async () => {
    await mount(fakeHealthClient({ report: vi.fn(async () => { throw { code: "snapshot_not_found", message: "no repository snapshot" }; }) as never }));
    expect(container.textContent).toContain("no repository snapshot");
  });

  it("uses the core's band edges", () => {
    expect([bandOf(8.5), bandOf(7), bandOf(5.5), bandOf(4), bandOf(3.99)]).toEqual(["excellent", "good", "fair", "needs_work", "at_risk"]);
  });
  it("adds a map of every file in its folder, coloured by band, that zooms and opens the drawer", async () => {
    await mount();
    await click(all("button").find((b) => b.getAttribute("role") === "tab" && b.textContent === "Map"));
    const files = [...container.querySelectorAll("circle")].filter((c) => c.getAttribute("class")?.includes("mapFile"));
    expect(files.length).toBe(report().files.length);
    expect(container.querySelector('[aria-label="Legend"]')!.textContent).toContain("At risk (1)");
    const group = container.querySelector('[aria-label="Code health map"] svg > g')!;
    const before = group.getAttribute("transform");
    await click(container.querySelector('button[aria-label="Zoom in"]'));
    expect(group.getAttribute("transform")).not.toBe(before);
    await click(container.querySelector('button[aria-label="Fit"]'));
    expect(group.getAttribute("transform")).toBe(before);
    await act(async () => files[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(container.querySelector("aside")).not.toBeNull();
  });
});
