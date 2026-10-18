import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../wiki/harnessPageModel", () => ({ pageModel: vi.fn() }));
vi.mock("../store", () => ({ useWorkspaceStore: { getState: () => ({ activeModel: "chat-model", customProviders: [], providerStatus: {}, activeCustomProviderId: null }) } }));

import { fakeDocsClient } from "../wiki/docs.testing";
import { useBackground } from "./backgroundStore";
import type { BackgroundClient } from "./client";
import { offerDocumentationUpdate, runDocumentationUpdate } from "./documentationRunner";

function background(pages: string[]): BackgroundClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    jobs: vi.fn(async () => []),
    cancel: vi.fn(async () => undefined),
    start: vi.fn(async () => 7),
    progress: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    setBackground: vi.fn(async () => undefined),
    afterCommit: vi.fn(async () => ({ commit: "c1", files: ["src/a.rs", "src/b.rs"], pages: [{ id: "written:overview", title: "Overview" }] })),
    pending: vi.fn(async () => ({ pages, model: null })),
    queue: vi.fn(async () => undefined),
    done: vi.fn(async () => undefined),
  } as never;
}

function docs() {
  const client = fakeDocsClient({
    documentationPlan: vi.fn(async () => ({
      pages: [
        { id: "written:overview", kind: "overview", title: "Overview", files: 1, inputTokens: 1, state: "stale" },
        { id: "folder:dir:src", kind: "module", title: "src", files: 1, inputTokens: 1, state: "stale" },
      ],
      inputTokens: 2,
      settings: { model: "doc-model", style: null },
    })) as never,
    documentationSettings: vi.fn(async () => ({ model: "doc-model", style: null })) as never,
  });
  client.documentationBrief = vi.fn(async (_root: string, id: string) => ({ id, title: id, system: "s", prompt: id, inputChars: 1, style: "x", prewritten: null }));
  client.documentationSave = vi.fn(async () => ({}) as never);
  return client;
}

beforeEach(() => useBackground.setState({ jobs: [], questions: [] }));

describe("runDocumentationUpdate", () => {
  it("writes the queued pages leaves first as one job, marking each done", async () => {
    const bg = background(["written:overview", "folder:dir:src"]);
    const client = docs();
    const ask = vi.fn(async (brief: { prompt: string }) => `page ${brief.prompt}`);
    await runDocumentationUpdate("/r", { background: bg, docs: client, model: () => ask });
    expect(bg.start).toHaveBeenCalledWith("/r", "Updating documentation of r");
    expect(ask.mock.calls.map((c) => c[0].prompt)).toEqual(["folder:dir:src", "written:overview"]);
    expect(client.documentationSave).toHaveBeenCalledWith("/r", "folder:dir:src", "page folder:dir:src", "doc-model");
    expect(bg.done.mock.calls.map((c) => c[1])).toEqual(["folder:dir:src", "written:overview"]);
    expect(bg.finish).toHaveBeenCalledWith(7, false, null);
  });

  it("does nothing when nothing is queued", async () => {
    const bg = background([]);
    await runDocumentationUpdate("/r", { background: bg, docs: docs(), model: () => vi.fn() });
    expect(bg.start).not.toHaveBeenCalled();
  });

  it("stops when its job is cancelled from the bubble and leaves the rest queued", async () => {
    const bg = background(["written:overview", "folder:dir:src"]);
    const ask = vi.fn(async () => {
      useBackground.getState().setJobs([{ id: 7, kind: "documentation", root: "/r", label: "x", detail: null, done: null, total: null, state: "cancelled", message: null }]);
      return "text";
    });
    await runDocumentationUpdate("/r", { background: bg, docs: docs(), model: () => ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(bg.done).toHaveBeenCalledTimes(1);
    expect(bg.finish).not.toHaveBeenCalled();
  });
});

describe("offerDocumentationUpdate", () => {
  it("asks after a commit and queues and runs the update when accepted", async () => {
    const bg = background(["written:overview"]);
    await offerDocumentationUpdate("/r", { background: bg, docs: docs(), model: () => vi.fn(async () => "x") });
    const question = useBackground.getState().questions[0];
    expect(question.message).toContain("Your commit changed 2 files that 1 documentation page was written from (Overview)");
    question.onAccept();
    await vi.waitFor(() => expect(bg.finish).toHaveBeenCalled());
    expect(bg.queue).toHaveBeenCalledWith("/r", ["written:overview"], null);
  });

  it("asks nothing when no written page came from the commit", async () => {
    const bg = background([]);
    bg.afterCommit = vi.fn(async () => ({ commit: "c", files: ["x"], pages: [] }));
    await offerDocumentationUpdate("/r", { background: bg, docs: docs(), model: () => vi.fn() });
    expect(useBackground.getState().questions).toEqual([]);
  });
});
