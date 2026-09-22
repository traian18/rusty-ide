import { describe, expect, it } from "vitest";

import { InvalidTaskOutputError, parseGeneratedTaskGraph } from "./generatedTaskGraph";

describe("parseGeneratedTaskGraph", () => {
  it("parses a well-formed graph", () => {
    const graph = parseGeneratedTaskGraph(
      JSON.stringify({
        tasks: [
          { key: "task-1", title: "Set up schema", description: "Add the migration.", dependsOn: [] },
          { key: "task-2", title: "Add endpoint", description: "Wire the route.", dependsOn: ["task-1"] },
        ],
        contexts: [{ key: "context-1", title: "Schema snippet", content: "```sql\nCREATE TABLE x;\n```", taskKeys: ["task-1"] }],
      }),
    );
    expect(graph.tasks).toEqual([
      { key: "task-1", title: "Set up schema", description: "Add the migration.", dependsOn: [] },
      { key: "task-2", title: "Add endpoint", description: "Wire the route.", dependsOn: ["task-1"] },
    ]);
    expect(graph.contexts).toEqual([
      { key: "context-1", title: "Schema snippet", content: "```sql\nCREATE TABLE x;\n```", taskKeys: ["task-1"] },
    ]);
  });

  it("extracts JSON embedded in surrounding prose", () => {
    const spec = { tasks: [{ key: "t1", title: "Do it", description: "Do the thing.", dependsOn: [] }] };
    const graph = parseGeneratedTaskGraph(`Sure, here's the plan:\n${JSON.stringify(spec)}\nLet me know if that works!`);
    expect(graph.tasks).toHaveLength(1);
  });

  it("throws InvalidTaskOutputError for malformed JSON", () => {
    expect(() => parseGeneratedTaskGraph("not json")).toThrow(InvalidTaskOutputError);
  });

  it("throws InvalidTaskOutputError when tasks is missing or not an array", () => {
    expect(() => parseGeneratedTaskGraph(JSON.stringify({ contexts: [] }))).toThrow(InvalidTaskOutputError);
    expect(() => parseGeneratedTaskGraph(JSON.stringify({ tasks: "nope" }))).toThrow(InvalidTaskOutputError);
  });

  it("throws InvalidTaskOutputError when every task is missing a title or description", () => {
    expect(() =>
      parseGeneratedTaskGraph(JSON.stringify({ tasks: [{ key: "t1", title: "", description: "" }] })),
    ).toThrow(InvalidTaskOutputError);
  });

  it("drops individual tasks missing a title or description, keeping the valid ones", () => {
    const graph = parseGeneratedTaskGraph(
      JSON.stringify({
        tasks: [
          { key: "t1", title: "", description: "missing title" },
          { key: "t2", title: "Valid", description: "This one is fine." },
        ],
      }),
    );
    expect(graph.tasks).toEqual([{ key: "t2", title: "Valid", description: "This one is fine.", dependsOn: [] }]);
  });

  it("deduplicates repeated task keys by appending a numeric suffix", () => {
    const graph = parseGeneratedTaskGraph(
      JSON.stringify({
        tasks: [
          { key: "dup", title: "First", description: "First one." },
          { key: "dup", title: "Second", description: "Second one." },
          { key: "dup", title: "Third", description: "Third one." },
        ],
      }),
    );
    expect(graph.tasks.map((task) => task.key)).toEqual(["dup", "dup-2", "dup-3"]);
  });

  it("defaults a missing key to task-<n>", () => {
    const graph = parseGeneratedTaskGraph(JSON.stringify({ tasks: [{ title: "No key", description: "d" }] }));
    expect(graph.tasks[0].key).toBe("task-1");
  });

  it("filters a task's dependsOn down to keys of strictly earlier tasks", () => {
    const graph = parseGeneratedTaskGraph(
      JSON.stringify({
        tasks: [
          { key: "t1", title: "First", description: "d", dependsOn: ["t2"] }, // t2 doesn't exist yet -- dropped
          { key: "t2", title: "Second", description: "d", dependsOn: ["t1", "t2", "missing"] }, // self+missing dropped
        ],
      }),
    );
    expect(graph.tasks[0].dependsOn).toEqual([]);
    expect(graph.tasks[1].dependsOn).toEqual(["t1"]);
  });

  it("caps tasks at 20 and contexts at 30", () => {
    const tasks = Array.from({ length: 25 }, (_, i) => ({ key: `t${i}`, title: `Task ${i}`, description: "d" }));
    const graph = parseGeneratedTaskGraph(JSON.stringify({ tasks }));
    expect(graph.tasks).toHaveLength(20);
  });

  it("drops a context with empty content", () => {
    const graph = parseGeneratedTaskGraph(
      JSON.stringify({
        tasks: [{ key: "t1", title: "T", description: "d" }],
        contexts: [{ key: "c1", title: "Empty", content: "", taskKeys: ["t1"] }],
      }),
    );
    expect(graph.contexts).toEqual([]);
  });

  it("drops a context whose taskKeys don't reference any real task", () => {
    const graph = parseGeneratedTaskGraph(
      JSON.stringify({
        tasks: [{ key: "t1", title: "T", description: "d" }],
        contexts: [{ key: "c1", title: "Orphan", content: "some code", taskKeys: ["nonexistent"] }],
      }),
    );
    expect(graph.contexts).toEqual([]);
  });

  it("filters a context's taskKeys down to real task keys, keeping the context if any remain", () => {
    const graph = parseGeneratedTaskGraph(
      JSON.stringify({
        tasks: [{ key: "t1", title: "T", description: "d" }],
        contexts: [{ key: "c1", title: "Snippet", content: "code", taskKeys: ["t1", "nonexistent"] }],
      }),
    );
    expect(graph.contexts).toEqual([{ key: "c1", title: "Snippet", content: "code", taskKeys: ["t1"] }]);
  });

  it("deduplicates repeated context keys the same way as task keys", () => {
    const graph = parseGeneratedTaskGraph(
      JSON.stringify({
        tasks: [{ key: "t1", title: "T", description: "d" }],
        contexts: [
          { key: "dup", title: "First", content: "a", taskKeys: ["t1"] },
          { key: "dup", title: "Second", content: "b", taskKeys: ["t1"] },
        ],
      }),
    );
    expect(graph.contexts.map((context) => context.key)).toEqual(["dup", "dup-2"]);
  });
});
