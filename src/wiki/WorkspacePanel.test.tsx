// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceRepository } from "./client";
import { fakeDocsClient } from "./docs.testing";
import { WorkspacePanel } from "./WorkspacePanel";

let container: HTMLDivElement;
let root: Root;

const repository = (name: string, overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository => ({
  id: `/ws/${name}`, name, path: name, kind: "workspace", branch: "main", indexed: false, built_at_ms: null, files: 0, ...overrides,
});
async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const button = (text: string, within: ParentNode = container) => [...within.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

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

async function mount(repositories: WorkspaceRepository[], handlers = { onOpen: vi.fn(), onIndexed: vi.fn() }, activeRoot = "/ws/api") {
  const client = fakeDocsClient({ workspaceRepositories: vi.fn(async () => repositories) as never });
  await act(async () => root.render(<WorkspacePanel client={client} root="/ws" activeRoot={activeRoot} revision={0} {...handlers} />));
  await settle();
  return { client, ...handlers };
}

describe("WorkspacePanel", () => {
  it("lists each repository with whether it is indexed, and says nothing is indexed just because it exists", async () => {
    await mount([repository("api", { indexed: true, files: 42 }), repository("web")]);
    const rows = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("api") && expect(rows[0]).toContain("Indexed · 42 files");
    expect(rows[1]).toContain("Not indexed");
    expect(container.textContent).toContain("none is indexed just because it exists");
  });

  it("opens a repository's documentation, except the one already open", async () => {
    const { onOpen } = await mount([repository("api"), repository("web")]);
    const rows = [...container.querySelectorAll("li")];
    expect((button("Open", rows[0]) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => button("Open docs", rows[1])!.click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "/ws/web" }));
  });

  it("indexes one repository on request, without Git history, and refreshes the list", async () => {
    const { client, onIndexed } = await mount([repository("api"), repository("web")]);
    const row = [...container.querySelectorAll("li")][1];
    await act(async () => button("Index", row)!.click());
    await settle();
    expect(client.refresh).toHaveBeenCalledWith("/ws/web", false);
    expect(onIndexed).toHaveBeenCalled();
    expect(client.workspaceRepositories).toHaveBeenCalledTimes(2);
  });
});
