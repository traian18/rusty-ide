// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeHealthClient } from "./health.testing";
import { HealthDrawer } from "./HealthDrawer";

let container: HTMLDivElement;
let root: Root;
const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const buttons = () => [...container.querySelectorAll("button")] as HTMLElement[];
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await settle();
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

describe("HealthDrawer", () => {
  it("shows the verdict, the costly issues and copies fix prompts", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const client = fakeHealthClient();
    const openFile = vi.fn();
    const onClose = vi.fn();
    await act(async () => root.render(<HealthDrawer client={client} root="/r" path="src/tangled.rs" revision={1} onClose={onClose} onOpenFile={openFile} />));
    await settle();
    const text = container.textContent!;
    for (const part of ["3.2 · At risk", "target 8.0", "code −5.60", "history −1.20", "2 bug fixes", "Alice", "Nested complexity", "−2.50", "nests control blocks 7 deep", "max nesting 7"]) expect(text).toContain(part);
    await click(buttons().find((b) => b.textContent === "Copy fix prompt"));
    expect(client.prompt).toHaveBeenCalledWith("/r", "src/tangled.rs", undefined);
    expect(writeText).toHaveBeenCalledWith("## Target\nsrc/tangled.rs all");
    await click(buttons().filter((b) => b.textContent?.includes("Copy prompt"))[1]);
    expect(client.prompt).toHaveBeenLastCalledWith("/r", "src/tangled.rs", "change_entropy:src/tangled.rs:1:");
    await click(buttons().find((b) => b.textContent === "lines 1-20"));
    expect(openFile).toHaveBeenCalledWith("src/tangled.rs", 1);
    expect(text).toContain("Structure: −2.50 (capped from 2.68)");
    await click(container.querySelector('button[aria-label="Close"]'));
    expect(onClose).toHaveBeenCalled();
  });
});
