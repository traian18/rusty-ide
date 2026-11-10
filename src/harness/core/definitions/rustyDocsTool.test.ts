import { describe, expect, it } from "vitest";

import docsIndex from "../rustyDocs/docsIndex.json";
import { buildDocsSearch, type DocPage } from "../rustyDocs/search";
import { rustyDocsTool } from "./rustyDocsTool";

const signal = {} as never;

const pages: DocPage[] = [
  {
    id: "goals",
    title: "Goals",
    summary: "Long-running objectives.",
    sections: [
      { heading: "", anchor: "", text: "A goal keeps an agent working." },
      { heading: "Start a goal", anchor: "start-a-goal", text: "Open the goal panel and describe the outcome." },
    ],
  },
  { id: "jev", title: "JEV decision model", summary: "Routing and reviews.", sections: [{ heading: "Connect JEV", anchor: "connect-jev", text: `Connect OpenRouter. ${"x".repeat(7000)}` }] },
];
const docs = rustyDocsTool(async () => ({ pages, search: buildDocsSearch(pages) }));
const run = async (args: unknown) => docs(args, signal);

describe("rusty_docs host tool", () => {
  it("searches with sections, links and the list of pages", async () => {
    const result = await run({ query: "how do I start a goal" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain("## Goals > Start a goal\nhttps://rusty-edit.dev/docs/goals/#start-a-goal");
    expect(result.output).toContain("Open the goal panel");
    expect(result.output).toContain("All pages");
    expect(result.output).toContain("- jev: JEV decision model");
  });

  it("cuts a long section and says how to read the rest", async () => {
    const result = await run({ query: "connect openrouter" });
    expect(result.ok && result.output).toContain('Read the rest with {"page": "jev"}');
    expect(result.ok && String(result.output).length).toBeLessThan(6500);
  });

  it("still offers the pages when nothing matches, so the model can look for itself", async () => {
    const result = await run({ query: "zebra" });
    expect(result.ok && result.output).toContain('No section matches "zebra"');
    expect(result.ok && result.output).toContain("- goals: Goals");
  });

  it("reads a whole page by id or by its link", async () => {
    const byId = await run({ page: "goals" });
    expect(byId.ok && byId.output).toContain("## Start a goal");
    expect(byId.ok && byId.output).toContain("A goal keeps an agent working.");
    expect(await run({ page: "https://rusty-edit.dev/docs/goals/#start-a-goal" })).toEqual(byId);
  });

  it("names the pages when asked for one that does not exist", async () => {
    const result = await run({ page: "nope" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("- goals: Goals");
  });

  it("returns every page's summary and headings with no input", async () => {
    for (const args of [{}, undefined, { query: "  " }]) {
      const result = await run(args);
      expect(result.ok && result.output).toContain("- goals: Goals. Long-running objectives.\n  Sections: Start a goal");
    }
  });
});

describe("rusty_docs against the shipped documentation", () => {
  const search = buildDocsSearch(docsIndex);
  const QUESTIONS: [string, string][] = [
    ["how does spec driven work", "spec-driven-development"],
    ["how do goals work", "goals"],
    ["why do I have JEV and how does it work", "jev"],
    ["where can I enable smart read", "smart-tools"],
    ["where do I enable auto model selection", "auto-model-selection"],
    ["how do I connect an MCP server", "mcp"],
    ["what is the .rusty folder", "rusty-folder"],
    ["why is my chat being compacted", "agent-mode"],
  ];

  it.each(QUESTIONS)("%s -> %s", (question, page) => {
    expect(search(question, 4).map((hit) => hit.page.id)).toContain(page);
  });

  it("answers from the index the app ships, loaded on demand", async () => {
    const result = await rustyDocsTool()({ query: "why do I have JEV and how does it work" }, signal);
    expect(result.ok && result.output).toContain("https://rusty-edit.dev/docs/jev/");
    expect(result.ok && result.output).toContain("- goals: Goals");
  });

  it("finds the Workflow Author skill first, however it is asked about", () => {
    const search = buildDocsSearch(docsIndex as DocPage[]);
    for (const question of [
      "what is the workflow author skill",
      "how do I use workflow-author",
      "can an agent create a workflow for me from a description",
      "workflow author save failed with issues",
    ]) {
      const [top] = search(question, 3);
      expect(top?.page.id, question).toBe("skills");
      expect(top?.section.anchor, question).toMatch(/^workflow-author-skill-/);
    }
  });

  it("gives every section a page the tool can link to", () => {
    expect(docsIndex.length).toBeGreaterThan(0);
    for (const page of docsIndex) {
      expect(page.title).not.toBe("");
      expect(page.sections.length).toBeGreaterThan(0);
    }
  });
});
