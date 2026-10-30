import { describe, expect, it, vi } from "vitest";

import { fakeDocsClient } from "./docs.testing";
import { writePages } from "./writer";
import type { PlannedPage } from "./written";

const planned = (id: string, kind: string): PlannedPage => ({ id, kind, title: id, files: 1, inputTokens: 10, state: "missing" });

describe("writePages", () => {
  it("writes leaves first, one brief at a time, and keeps going after a failed page", async () => {
    const client = fakeDocsClient();
    const order: string[] = [];
    client.documentationBrief = vi.fn(async (_root: string, id: string) => ({ id, title: id, system: "s", prompt: `p:${id}`, inputChars: 1, style: "x" }));
    client.documentationSave = vi.fn(async () => ({}) as never);
    const ask = vi.fn(async (brief: { prompt: string }) => {
      order.push(brief.prompt);
      if (brief.prompt === "p:m1") throw new Error("rate limited");
      return "## A\nText [1].";
    });
    const seen: number[] = [];
    const result = await writePages(client, "/r", [planned("o", "overview"), planned("m1", "module"), planned("m2", "module")], "model", ask, new AbortController().signal, (p) => seen.push(p.done));
    expect(order).toEqual(["p:m1", "p:m2", "p:o"]);
    expect(client.documentationSave).toHaveBeenCalledTimes(2);
    expect(client.documentationSave).toHaveBeenCalledWith("/r", "m2", "## A\nText [1].", "model");
    expect(result.failures).toEqual([{ id: "m1", message: "rate limited" }]);
    expect(result.done).toBe(3);
    expect(seen.at(-1)).toBe(3);
  });

  it("stops asking once cancelled", async () => {
    const client = fakeDocsClient();
    const controller = new AbortController();
    const ask = vi.fn(async () => {
      controller.abort();
      return "x";
    });
    client.documentationSave = vi.fn(async () => ({}) as never);
    const result = await writePages(client, "/r", [planned("a", "module"), planned("b", "module")], "m", ask, controller.signal, () => undefined);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.done).toBe(1);
  });
});

describe("writePage", () => {
  it("saves a prewritten page without asking a model", async () => {
    const { writePage } = await import("./writer");
    const client = fakeDocsClient();
    client.documentationBrief = vi.fn(async () => ({ id: "written:glossary", title: "Glossary", system: "", prompt: "", inputChars: 0, style: "x", prewritten: "| Term |" }));
    client.documentationSave = vi.fn(async () => ({}) as never);
    const ask = vi.fn();
    await writePage(client, "/r", "written:glossary", "m", ask, new AbortController().signal);
    expect(ask).not.toHaveBeenCalled();
    expect(client.documentationSave).toHaveBeenCalledWith("/r", "written:glossary", "| Term |", "repository documents");
  });
});
