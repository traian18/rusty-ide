// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROOT } from "../architecture/testing";
import { useDashboard } from "./dashboardState";
import { fakeDashboardClient } from "./dashboard.testing";
import { fakeHealthClient } from "../health/health.testing";
import { fakeDocsClient } from "../wiki/docs.testing";
import { DocumentationTab } from "./DocumentationTab";

let container: HTMLDivElement;
let root: Root;

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const all = (tag: string) => [...container.querySelectorAll(tag)] as HTMLElement[];
const byText = (text: string, tag = "button") => all(tag).find((e) => e.textContent?.trim() === text) ?? all(tag).find((e) => e.textContent?.includes(text));
const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
  await settle();
};
const mount = async (client = fakeDashboardClient(), openFile = vi.fn(), docs = fakeDocsClient(), health = fakeHealthClient()) => {
  await act(async () => root.render(<DocumentationTab client={client} docsClient={docs} healthClient={health} root={ROOT} openFile={openFile} />));
  await settle();
  return { client, openFile };
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useDashboard.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("DocumentationTab", () => {
  it("opens on the project documentation and offers code health and files", async () => {
    const plan = { pages: [{ id: "written:overview", kind: "overview", title: "Overview", files: 9, inputTokens: 600, state: "fresh" }, { id: "folder:dir:src", kind: "module", title: "src", files: 4, inputTokens: 300, state: "missing" }], inputTokens: 300, settings: { model: null, style: null } };
    const docs = fakeDocsClient({ documentationPlan: vi.fn(async () => plan) as never });
    const health = fakeHealthClient();
    await mount(fakeDashboardClient(), vi.fn(), docs, health);
    const nav = container.querySelector('nav[aria-label="Documentation pages"]')!;
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["Project documentation", "Specs", "Code health", "Files"]);
    expect(container.querySelector('header[aria-label="Project documentation"]')!.textContent).toContain("2 pages: 1 to start with (overview, getting started, key concepts, how it works, architecture and more) and 1 module; 1 written");
    expect(byText("Index in background", "label")).toBeTruthy();
    await click(byText("Code health"));
    expect(health.report).toHaveBeenCalledWith(ROOT);
    expect(container.querySelector('article[aria-label="Code health"]')).not.toBeNull();
  });

  it("opens a file from the files table in the drawer, and copies its fix prompt", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { client } = await mount();
    await click(byText("Files"));
    await click(all("td").find((td) => td.textContent?.startsWith("src/a.rs")));
    expect(client.file).toHaveBeenCalledWith(ROOT, "src/a.rs");
    const drawer = container.querySelector('aside[aria-label="File src/a.rs"]')!;
    expect(drawer.textContent).toContain("Import cycle between src/a.rs and src/b.rs.");
    expect(drawer.textContent).toContain("imported by 2");
    await click(byText("Copy fix prompt"));
    expect(client.prompt).toHaveBeenCalledWith(ROOT, "src/a.rs", undefined);
    expect(writeText).toHaveBeenCalledWith("## Target\nsrc/a.rs all");
    expect(byText("Copied")).toBeTruthy();
    await click(byText("Copy prompt"));
    expect(client.prompt).toHaveBeenLastCalledWith(ROOT, "src/a.rs", "import-cycle:1");
  });

  it("opens a cited line and closes the drawer", async () => {
    useDashboard.setState({ page: "files" });
    const { openFile } = await mount();
    useDashboard.getState().select("src/a.rs");
    await settle();
    await click(byText("line 1"));
    expect(openFile).toHaveBeenCalledWith({ type: "file", path: `${ROOT}/src/a.rs`, line: 1 });
    await click(container.querySelector('button[aria-label="Close"]'));
    expect(container.querySelector("aside")).toBeNull();
  });

  it("shows every file in one map, narrows the table to a folder, changes the lens and filters the table", async () => {
    const { client } = await mount();
    await click(byText("Files"));
    expect(client.allFiles).toHaveBeenCalledWith(ROOT);
    const cells = [...container.querySelectorAll<HTMLElement>("[data-file]")];
    expect(cells.map((c) => c.dataset.file).sort()).toEqual(["src/a.rs", "src/b.rs", "web/app.ts"]);
    const folders = [...container.querySelectorAll<HTMLElement>("button[data-folder]")];
    expect(folders.map((f) => f.textContent).sort()).toEqual(["src", "web"]);
    expect(container.querySelector('[aria-label="Legend"]')!.textContent).toContain("typescript");
    await click(folders.find((f) => f.textContent === "src"));
    expect(useDashboard.getState().folder).toBe("src");
    expect(client.files).toHaveBeenLastCalledWith(ROOT, expect.objectContaining({ path: "src", sort: "lines" }));
    await click(cells.find((c) => c.dataset.file === "web/app.ts"));
    expect(useDashboard.getState().selected).toBe("web/app.ts");
    await click(all("button").find((b) => b.getAttribute("role") === "radio" && b.textContent === "Findings"));
    expect(container.querySelector('[aria-label="Legend"]')!.textContent).toContain("high");
    await click(byText("Commits"));
    expect(client.files).toHaveBeenLastCalledWith(ROOT, expect.objectContaining({ sort: "commits", descending: true }));
    await click(container.querySelector('button[aria-label="Show every file"]'));
    expect(useDashboard.getState().folder).toBe("");
  });

  it("asks to analyze a repository with no index yet", async () => {
    const client = fakeDashboardClient({ open: vi.fn(async () => ({ root: ROOT, discovery: { cargo: true, package_json: true, symlink_safe: true }, snapshot: null, git: null, findings: null, built_at_ms: null })) as never });
    const docs = fakeDocsClient();
    await mount(client, vi.fn(), docs);
    expect(container.textContent).toContain("has not been analyzed yet");
    expect(docs.documentationPlan).not.toHaveBeenCalled();
  });

  it("shows a failed load as an error", async () => {
    const docs = fakeDocsClient({ documentationPlan: vi.fn(async () => { throw { code: "snapshot_not_found", message: "no repository snapshot" }; }) as never });
    await mount(fakeDashboardClient(), vi.fn(), docs);
    expect(container.textContent).toContain("no repository snapshot");
  });
});
