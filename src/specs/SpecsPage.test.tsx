// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpecsPage } from "./SpecsPage";
import type { SpecsOverview } from "./model";
import { useSpecLaunch } from "./launchStore";
import { useSpecsView } from "./specsState";
import { useWorkspaceStore } from "../store";
import { change, emptyOverview, fakeSpecsClient } from "./specs.testing";

let container: HTMLDivElement;
let root: Root;

const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const all = (selector: string, within: ParentNode = document) => [...within.querySelectorAll(selector)] as HTMLElement[];
const button = (text: string, within: ParentNode = document) => all("button", within).find((b) => b.textContent?.trim() === text);
const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
  await settle();
};
const overview = (overrides: Partial<SpecsOverview> = {}): SpecsOverview => ({ ...emptyOverview, exists: true, project: true, ...overrides });

async function mount(client = fakeSpecsClient(), openFile = vi.fn()) {
  await act(async () => root.render(<SpecsPage client={client} root="/repo" openFile={openFile} />));
  await settle();
  return { client, openFile };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useSpecsView.getState().reset();
  useSpecLaunch.getState().clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SpecsPage", () => {
  it("offers to set up specs when there are none, and loads again afterwards", async () => {
    const { client } = await mount();
    expect(container.textContent).toContain("This repository has no specs yet.");
    await click(button("Set up specs"));
    expect(client.init).toHaveBeenCalledWith("/repo");
    expect(client.overview).toHaveBeenCalledTimes(2);
  });

  it("lists changes by status with their progress and opens the first unfinished one", async () => {
    const client = fakeSpecsClient({
      overview: vi.fn(async () => overview({ changes: [change({ dir: "0001-done", title: "Old", status: "done", tasksDone: 2, tasksTotal: 2 }), change({ dir: "0002-albums", number: 2, title: "Photo albums", status: "building" })] })),
      document: vi.fn(async (_root: string, path: string) => `# Text of ${path}`),
    });
    await mount(client);
    const nav = container.querySelector('nav[aria-label="Specs"]')!;
    expect(all("button", nav).map((row) => row.textContent)).toEqual(expect.arrayContaining(["0002 Photo albums1/3", "0001 Old2/2"]));
    expect(container.querySelector('section[aria-label="Change Photo albums"]')).not.toBeNull();
    expect(client.document).toHaveBeenCalledWith("/repo", "specs/changes/0002-albums/spec.md");
    expect(container.textContent).toContain("Text of specs/changes/0002-albums/spec.md");
  });

  it("says which step writes a document that does not exist", async () => {
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change()] })) }));
    await click(button("Design"));
    expect(container.textContent).toContain("design.md does not exist yet; it is written by the Plan step.");
  });

  it("opens the file of a warning at its line", async () => {
    const warning = { file: "specs/changes/0001-albums/spec.md", line: 7, severity: "warning" as const, message: "C2 is not named by any task" };
    const { openFile } = await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change({ warnings: [warning] })] })) }));
    await click(all("button").find((b) => b.textContent?.includes("C2 is not named by any task · spec.md:7")));
    expect(openFile).toHaveBeenCalledWith("specs/changes/0001-albums/spec.md", 7);
  });

  it("shows the checklist and ticks a task, then reloads", async () => {
    const tasks = [
      { id: "T1", title: "Model", done: true, line: 1, requirements: ["R1"], criteria: ["C1"], after: [], instructions: "" },
      { id: "T2", title: "Sidebar", done: false, line: 2, requirements: ["R1"], criteria: ["C2"], after: ["T1"], instructions: "Wire it." },
    ];
    const client = fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change({ taskDocuments: ["T2-sidebar.md"] })] })), tasks: vi.fn(async () => tasks) });
    const { openFile } = await mount(client);
    await click(button("Tasks"));
    expect(all('input[type="checkbox"]').map((box) => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(container.textContent).toContain("R1 (C2) · after T1");
    await click(all('input[aria-label="T2 Sidebar"]')[0]);
    expect(client.tick).toHaveBeenCalledWith("/repo", "0001-albums", "T2", true);
    expect(client.overview).toHaveBeenCalledTimes(2);
    await click(button("Open T2-sidebar.md"));
    expect(openFile).toHaveBeenCalledWith("specs/changes/0001-albums/tasks/T2-sidebar.md");
  });

  it("creates a change with a Git branch unless the box is cleared", async () => {
    const created = { dir: "0003-dark-mode", files: [], branch: { kind: "created" as const, name: "spec/0003-dark-mode" } };
    const client = fakeSpecsClient({ createChange: vi.fn(async () => created) });
    await mount(client);
    await click(button("New change"));
    const dialog = document.body;
    const branchBox = dialog.querySelector("#new-change-branch") as HTMLInputElement;
    expect(branchBox.checked).toBe(true);
    const title = dialog.querySelector("#new-change-name") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Dark mode");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Create"));
    expect(client.createChange).toHaveBeenCalledWith("/repo", expect.objectContaining({ title: "Dark mode", branch: true, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    expect(useSpecsView.getState().selection).toEqual({ kind: "change", dir: "0003-dark-mode" });
  });

  it("asks for no branch when the box is cleared", async () => {
    const client = fakeSpecsClient();
    await mount(client);
    await click(button("New change"));
    await click(document.body.querySelector("#new-change-branch"));
    const title = document.body.querySelector("#new-change-name") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Dark mode");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Create"));
    expect(client.createChange).toHaveBeenCalledWith("/repo", expect.objectContaining({ branch: false }));
  });

  it("follows file changes by loading again once things settle", async () => {
    let notify: () => void = () => undefined;
    const client = fakeSpecsClient({ onChanged: vi.fn(async (callback: () => void) => { notify = callback; return () => undefined; }) });
    await mount(client);
    notify();
    notify();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    await settle();
    expect(client.overview).toHaveBeenCalledTimes(2);
  });

  it("shows the project and its warnings when there are no changes yet", async () => {
    const projectWarnings = [{ file: "specs/project.md", line: null, severity: "note" as const, message: "project.md has no Principles section" }];
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ projectWarnings })), document: vi.fn(async () => "# Project text") }));
    expect(container.querySelector('section[aria-label="Project"]')!.textContent).toContain("project.md has no Principles section");
    expect(container.textContent).toContain("Project text");
  });

  it("opens an Agent tab for Specify and waits for the person to send it", async () => {
    useWorkspaceStore.setState({ rootPath: "/repo" });
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change({ status: "draft", nextStep: "specify" })] })) }));
    await click(button("Specify"));
    const pending = useSpecLaunch.getState().pending;
    expect(pending?.run).toEqual({ root: "/repo", change: "0001-albums", step: "specify" });
    expect(pending?.message).toContain("specs/changes/0001-albums/spec.md");
    expect(useWorkspaceStore.getState().tabs.some((tab) => tab.id === pending?.tabId && tab.type === "agent")).toBe(true);
  });

  it("does not offer Design & tasks until there is a spec", async () => {
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change({ documents: ["change.md"] })] })) }));
    expect((button("Design & tasks") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers Implement once there are tasks, and opens an Agent tab for it", async () => {
    useWorkspaceStore.setState({ rootPath: "/repo" });
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change()] })) }));
    await click(button("Implement"));
    expect(useSpecLaunch.getState().pending?.run).toEqual({ root: "/repo", change: "0001-albums", step: "implement" });
  });

  it("does not offer Implement before tasks.md exists", async () => {
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change({ documents: ["change.md", "spec.md"] })] })) }));
    expect((button("Implement") as HTMLButtonElement).disabled).toBe(true);
  });

  it("onboards an existing project in an Agent tab when there are no specs", async () => {
    useWorkspaceStore.setState({ rootPath: "/repo" });
    await mount();
    await click(button("Onboard this project"));
    const pending = useSpecLaunch.getState().pending;
    expect(pending?.run).toEqual({ root: "/repo", change: "", step: "start" });
    expect(pending?.message).toContain("specs/onboarding.md");
    expect(pending?.autoSend).toBeUndefined();
  });

  it("archives a change and goes back to the project", async () => {
    const client = fakeSpecsClient({
      overview: vi.fn(async () => overview({ changes: [change({ status: "done", nextStep: "archive" })] })),
      archive: vi.fn(async () => ({ archivedDir: "specs/archive/2026-10-30-0001-albums", merged: ["albums"], unmerged: [] })),
    });
    await mount(client);
    await click(button("Archive"));
    expect(client.archive).toHaveBeenCalledWith("/repo", "0001-albums", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), false);
    expect(useSpecsView.getState().selection).toEqual({ kind: "project" });
    expect(client.overview).toHaveBeenCalledTimes(2);
  });

  it("offers to archive an unfinished change anyway, and only then forces it", async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce({ code: "io_error", message: "The change is not finished: its status is building, not done." })
      .mockResolvedValueOnce({ archivedDir: "specs/archive/x", merged: [], unmerged: [] });
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change({ status: "building" })] })), archive }));
    await click(button("Archive"));
    expect(container.textContent).toContain("The change is not finished");
    await click(button("Archive anyway"));
    expect(archive).toHaveBeenLastCalledWith("/repo", "0001-albums", expect.any(String), true);
  });

  it("shows a merge problem without offering to force it", async () => {
    const archive = vi.fn().mockRejectedValue({ code: "io_error", message: "The requirements cannot be merged: R1: albums has no requirement named \"X\" to change" });
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ changes: [change({ status: "done" })] })), archive }));
    await click(button("Archive"));
    expect(container.textContent).toContain("cannot be merged");
    expect(button("Archive anyway")).toBeUndefined();
  });

  it("shows where a capability has drifted from the code", async () => {
    const warning = { file: "specs/capabilities/albums/spec.md", line: 6, severity: "note" as const, message: "`src/albums/gone.rs` is named here but does not exist in the repository" };
    const capability = { name: "albums", title: "Albums", purpose: null, requirements: 2, path: "specs/capabilities/albums/spec.md", warnings: [warning] };
    useSpecsView.getState().select({ kind: "capability", name: "albums" });
    const { openFile } = await mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ capabilities: [capability] })), document: vi.fn(async () => "# Albums") }));
    expect(container.querySelector('nav[aria-label="Specs"]')!.textContent).toContain("! 2");
    await click(all("button").find((b) => b.textContent?.includes("gone.rs")));
    expect(openFile).toHaveBeenCalledWith("specs/capabilities/albums/spec.md", 6);
  });

  it("offers to import an OpenSpec folder and opens the first imported change", async () => {
    const importForeign = vi.fn(async () => ({ project: true, capabilities: ["albums"], changes: ["0001-add-rename"], skipped: [] }));
    const client = fakeSpecsClient({ foreign: vi.fn(async () => [{ source: "open_spec" as const, path: "openspec", capabilities: 1, changes: 1, archived: 0 }]), importForeign });
    await mount(client);
    expect(container.textContent).toContain("OpenSpec found in openspec: 1 capability, 1 change.");
    await click(button("Import from OpenSpec"));
    expect(importForeign).toHaveBeenCalledWith("/repo", "open_spec", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(useSpecsView.getState().selection).toEqual({ kind: "change", dir: "0001-add-rename" });
    expect(client.overview).toHaveBeenCalledTimes(2);
  });

  it("shows nothing about other tools when none is found", async () => {
    await mount();
    expect(container.textContent).not.toContain("found in");
  });

  describe("onboarding an existing project", () => {
    const entries = [
      { name: "albums", title: "Albums", purpose: "grouping photos", paths: ["src/albums/"], notes: "", written: true },
      { name: "import", title: "Import", purpose: "bringing photos in", paths: ["src/import/", "src/ui/ImportDialog.tsx"], notes: "", written: false },
      { name: "export", title: "Export", purpose: "", paths: [], notes: "", written: false },
    ];
    const mountWithList = (list = entries) => {
      useWorkspaceStore.setState({ rootPath: "/repo" });
      useSpecsView.getState().select({ kind: "project" });
      return mount(fakeSpecsClient({ overview: vi.fn(async () => overview({ onboarding: list })), document: vi.fn(async () => "# Project") }));
    };

    it("lists the proposed capabilities with what is written and what is not", async () => {
      await mountWithList();
      const card = container.querySelector('section[aria-label="Onboarding"]')!;
      expect(card.textContent).toContain("1 of 3 capability specs written");
      expect(card.textContent).toContain("grouping photos");
      expect(card.textContent).toContain("src/import/, src/ui/ImportDialog.tsx");
      expect(button("Write all remaining (2)")).toBeTruthy();
    });

    it("writes one capability's spec in an Agent tab the person sends", async () => {
      await mountWithList();
      const row = all("li", container.querySelector('ul[aria-label="Capabilities to write"]')!)[1];
      await click(button("Write spec", row));
      const pending = useSpecLaunch.getState().pending;
      expect(pending?.run).toEqual({ root: "/repo", change: "import", step: "capability" });
      expect(pending?.message).toContain("capability Import, into specs/capabilities/import/spec.md");
      expect(pending?.autoSend).toBeUndefined();
    });

    it("writes every missing spec one after another, starting without a send", async () => {
      await mountWithList();
      await click(button("Write all remaining (2)"));
      const pending = useSpecLaunch.getState().pending;
      expect(pending?.run.change).toBe("import");
      expect(pending?.autoSend).toBe(true);
      expect(pending?.queue?.map((queued) => queued.run.change)).toEqual(["export"]);
    });

    it("has nothing to write when every spec exists, and says when the list is empty", async () => {
      await mountWithList(entries.map((entry) => ({ ...entry, written: true })));
      expect((button("All written") as HTMLButtonElement).disabled).toBe(true);
      await act(async () => root.render(<div />));
      await mountWithList([]);
      expect(container.textContent).toContain("The list has no capabilities.");
    });

    it("opens the list for editing and surveys again", async () => {
      const { openFile } = await mountWithList();
      await click(button("Edit onboarding.md"));
      expect(openFile).toHaveBeenCalledWith("specs/onboarding.md");
      await click(button("Survey again", container.querySelector('section[aria-label="Onboarding"]')!));
      expect(useSpecLaunch.getState().pending?.run.step).toBe("start");
    });
  });

  it("exports the specs to another tool's layout and says what was written", async () => {
    const exportTo = vi.fn(async () => ({ written: ["openspec/project.md", "openspec/specs/albums/spec.md"], skipped: [] }));
    useSpecsView.getState().select({ kind: "project" });
    const client = fakeSpecsClient({ overview: vi.fn(async () => overview()), document: vi.fn(async () => "# Project"), exportTo });
    await mount(client);
    await click(button("Export to OpenSpec"));
    expect(exportTo).toHaveBeenCalledWith("/repo", "open_spec", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    await click(button("Export to Spec Kit"));
    expect(exportTo).toHaveBeenLastCalledWith("/repo", "spec_kit", expect.any(String));
    expect(client.overview).toHaveBeenCalledTimes(3);
  });

  it("shows an export that fails", async () => {
    useSpecsView.getState().select({ kind: "project" });
    await mount(fakeSpecsClient({ overview: vi.fn(async () => overview()), document: vi.fn(async () => "# Project"), exportTo: vi.fn(async () => { throw { code: "io_error", message: "disk full" }; }) }));
    await click(button("Export to Spec Kit"));
    expect(container.textContent).toContain("disk full");
  });
});
