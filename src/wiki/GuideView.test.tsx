// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDocsClient } from "./docs.testing";
import { GuideView } from "./GuideView";
import type { DocumentationPlan, WrittenView } from "./written";

let container: HTMLDivElement;
let root: Root;
const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const byText = (text: string, tag = "button") => [...container.querySelectorAll(tag)].find((e) => e.textContent?.trim().includes(text)) as HTMLElement | undefined;
const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
  await settle();
};

const plan = (overrides: Partial<DocumentationPlan> = {}): DocumentationPlan => ({
  pages: [
    { id: "written:overview", kind: "overview", title: "Overview", files: 9, inputTokens: 6000, state: "missing" },
    { id: "written:architecture", kind: "architecture", title: "Architecture", files: 9, inputTokens: 9000, state: "missing" },
    { id: "folder:dir:src", kind: "module", title: "src", files: 5, inputTokens: 3000, state: "fresh" },
  ],
  inputTokens: 15000,
  settings: { model: null, style: null },
  ...overrides,
});

const written: WrittenView = {
  freshness: "fresh",
  diagrams: [{ key: "components", title: "How the components depend on each other", svg: "<svg role=\"img\"><title>d</title></svg>" }],
  page: {
    id: "written:overview",
    kind: "overview",
    title: "demo (overview)",
    markdown: "## What it is\nA demo crate configured in `Cargo.toml`.\n@@diagram:components@@\n## Where to start\nRead `src/lib.rs`.",
    footnotes: [
      { n: 1, reference: { kind: "lines", citation: { file: "Cargo.toml", start_line: 1, end_line: 3, content_hash: "h" } }, excerpt: "" },
      { n: 2, reference: { kind: "lines", citation: { file: "src/lib.rs", start_line: 1, end_line: 1, content_hash: "h" } }, excerpt: "" },
    ],
    diagrams: ["components"],
    facts_digest: "d",
    author: { model: "m1", style: "comprehensive", written_at_ms: 0, commit: null },
    dropped: 2,
    needs_review: false,
  },
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

describe("GuideView", () => {
  it("shows the pages with their state and offers to write one that does not exist, with its cost", async () => {
    const client = fakeDocsClient({ documentationPlan: vi.fn(async () => plan()) as never });
    await act(async () => root.render(<GuideView client={client} root="/r" revision={1} openCitation={vi.fn()} makeModel={() => vi.fn()} />));
    await settle();
    expect(container.querySelector('nav[aria-label="Documentation pages"]')!.textContent).toContain("Architecture");
    expect(container.textContent).toContain("Modules");
    expect(container.textContent).toContain("Overview has not been written yet");
    expect(container.textContent).toContain("About 6k input tokens");
  });

  it("asks before spending, then writes the pages that are missing and reloads", async () => {
    const save = vi.fn(async () => written);
    const model = vi.fn(async () => "## A\nText [1].");
    const client = fakeDocsClient({ documentationPlan: vi.fn(async () => plan()) as never, documentationSave: save as never });
    await act(async () => root.render(<GuideView client={client} root="/r" revision={1} openCitation={vi.fn()} makeModel={() => model} />));
    await settle();
    await click(byText("Write documentation (2)"));
    expect(model).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2 pages, about 15k input tokens");
    await click(byText("Write", "button") && [...container.querySelectorAll("button")].find((b) => b.textContent === "Write"));
    expect(model).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(client.documentationPlan).toHaveBeenCalledTimes(2);
  });

  it("renders a written page with its diagram, linked file names and the demoted count", async () => {
    const openCitation = vi.fn();
    const client = fakeDocsClient({ documentationPlan: vi.fn(async () => plan()) as never, documentationPage: vi.fn(async () => written) as never });
    await act(async () => root.render(<GuideView client={client} root="/r" revision={1} openCitation={openCitation} makeModel={() => vi.fn()} />));
    await settle();
    expect(container.querySelector("figure svg")).not.toBeNull();
    expect(container.textContent).toContain("A demo crate");
    expect(container.textContent).toContain("2 names the model used were not found in the code");
    expect(container.querySelector('[aria-label="Files this page names"]')!.textContent).toContain("src/lib.rs");
    await click(container.querySelector('a[href="#file:Cargo.toml"]'));
    expect(openCitation).toHaveBeenCalledWith({ file: "Cargo.toml", start_line: 1, end_line: 1, content_hash: "" }, false);
  });

  it("keeps the model and style chosen for this repository", async () => {
    const client = fakeDocsClient({ documentationPlan: vi.fn(async () => plan()) as never });
    await act(async () => root.render(<GuideView client={client} root="/r" revision={1} openCitation={vi.fn()} makeModel={() => vi.fn()} />));
    await settle();
    expect(container.querySelector("#docs-model")).not.toBeNull();
    expect(container.querySelector("#docs-style")).not.toBeNull();
  });
});
