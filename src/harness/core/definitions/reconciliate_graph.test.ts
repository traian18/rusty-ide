import { describe, expect, it, vi } from "vitest";

import type { ReconciliateGraphInput } from "../../contract";
import type { RunHost } from "../../contract";
import type { HostToolHandler } from "../CoreHarness";
import type { SessionRecipe } from "../SessionRecipe";
import { createTranscript, type Transcript } from "../transcript";
import { reconciliateGraphDefinition } from "./reconciliate_graph";

function input(overrides: Partial<ReconciliateGraphInput> = {}): ReconciliateGraphInput {
  return {
    tabId: "tab-1",
    model: "claude-opus-4-20250514",
    nodes: [],
    workspaceRoot: "/workspace",
    customProvider: {
      id: "p1",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      models: [],
    },
    duplicateFiles: {},
    ...overrides,
  };
}

function transcriptWith(text: string): Transcript {
  const transcript = createTranscript();
  transcript.push("m1", text);
  return transcript;
}

function fakeHost(overrides: Partial<RunHost> = {}): RunHost {
  return {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    requestPermission: vi.fn(),
    ...overrides,
  };
}

type RunSessionCall = {
  recipe: SessionRecipe;
  promptText: string;
  hostTools?: Record<string, HostToolHandler>;
  onLog?: (message: string) => void;
};

describe("reconciliateGraphDefinition", () => {
  it("supports() is true for a provider that maps to the host-routed backend", () => {
    expect(reconciliateGraphDefinition.supports?.(input())).toBe(true);
  });

  it("supports() is false for an unsupported provider", () => {
    const withUnmapped = input({
      customProvider: {
        id: "p1",
        name: "Codex",
        baseUrl: "",
        apiKey: "",
        apiType: "openai-completions",
        transport: "some-future-sdk" as any, // codex/claude-code/copilot are now core-supported (Phase 3); this simulates a transport core does not recognize yet
        models: [],
      },
    });
    expect(reconciliateGraphDefinition.supports?.(withUnmapped)).toBe(false);
  });

  it("orchestrate() throws for an unsupported provider before ever calling runSession()", async () => {
    const withUnmapped = input({
      customProvider: {
        id: "p1",
        name: "Codex",
        baseUrl: "",
        apiKey: "",
        apiType: "openai-completions",
        transport: "some-future-sdk" as any, // codex/claude-code/copilot are now core-supported (Phase 3); this simulates a transport core does not recognize yet
        models: [],
      },
    });
    const runSession = vi.fn();
    await expect(
      reconciliateGraphDefinition.orchestrate?.({ input: withUnmapped, host: fakeHost(), onEvent: () => {}, signal: new AbortController().signal, runSession }),
    ).rejects.toThrow(/cannot run on core/);
    expect(runSession).not.toHaveBeenCalled();
  });

  it("orchestrate() throws when no task-owned files are available at all", async () => {
    const runSession = vi.fn();
    await expect(
      reconciliateGraphDefinition.orchestrate?.({ input: input(), host: fakeHost(), onEvent: () => {}, signal: new AbortController().signal, runSession }),
    ).rejects.toThrow(/No task-owned VFS files/);
  });

  it("orchestrate() returns the sidecar's own 'nothing to reconcile' message when duplicateFiles is empty but task files exist", async () => {
    const events: unknown[] = [];
    const runSession = vi.fn();
    const result = await reconciliateGraphDefinition.orchestrate?.({
      input: input({ nodes: [{ id: "t1", modifiedFiles: ["a.ts"] }], duplicateFiles: {} }),
      host: fakeHost(),
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
      runSession,
    });
    expect(result).toEqual({
      response: "No unreconciled overlapping task files were supplied. Ordinary changed files remain TaskNode-owned for Apply Rusty.",
      reviewedFiles: [],
      reconciledFiles: [],
      modifiedFiles: [],
    });
    expect(runSession).not.toHaveBeenCalled();
  });

  it("orchestrate() calls runSession() once per overlapping file, with a recipe/prompt scoped to that one file", async () => {
    const host = fakeHost({ readFile: vi.fn().mockResolvedValue("current content") });
    const calls: RunSessionCall[] = [];
    const runSession = vi.fn(async (call: RunSessionCall) => {
      calls.push(call);
      return transcriptWith(`Resolved ${call.recipe.system_prompt ? "x" : "y"}`);
    });
    const result = await reconciliateGraphDefinition.orchestrate?.({
      input: input({
        nodes: [
          { id: "t1", name: "Add auth", prompt: "Add auth middleware.", modifiedFiles: ["src/a.ts"] },
          { id: "t2", name: "Add logging", prompt: "Add request logging.", modifiedFiles: ["src/b.ts"] },
        ],
        duplicateFiles: { "src/a.ts": ["t1", "t2"] },
      }),
      host,
      onEvent: () => {},
      signal: new AbortController().signal,
      runSession,
    });
    expect(runSession).toHaveBeenCalledTimes(1);
    const call = calls[0];
    expect(call.recipe.integration).toBe("host");
    expect(call.recipe.host_tools?.map((t) => t.name).sort()).toEqual(["read_file", "write_file"]);
    expect(call.recipe.system_prompt).toContain("code reconciliation model");
    expect(call.promptText).toContain("This file was modified by 2 task nodes (Add auth, Add logging)");
    expect(call.promptText).toContain("\"path\": \"/workspace/src/a.ts\"");
    expect(result).toMatchObject({ reviewedFiles: ["/workspace/src/a.ts"] });
  });

  it("orchestrate() finalizes a file the model reviewed but didn't write, reporting modified: false", async () => {
    const readFile = vi.fn().mockResolvedValue("unchanged content");
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const host = fakeHost({ readFile, writeFile });
    const events: unknown[] = [];
    const runSession = vi.fn().mockResolvedValue(transcriptWith("Already satisfies both tasks."));
    const result = await reconciliateGraphDefinition.orchestrate?.({
      input: input({ nodes: [{ id: "t1", modifiedFiles: ["a.ts"] }], duplicateFiles: { "a.ts": ["t1"] } }),
      host,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
      runSession,
    });
    expect(writeFile).toHaveBeenCalledWith("/workspace/a.ts", "unchanged content", expect.anything());
    expect(result).toMatchObject({ reconciledFiles: ["/workspace/a.ts"], modifiedFiles: [] });
    expect(events).toContainEqual({
      kind: "file_complete",
      filePath: "/workspace/a.ts",
      taskIds: ["t1"],
      modified: false,
      response: "Already satisfies both tasks.",
    });
  });

  it("orchestrate() does not re-finalize a file the model's own write_file tool already modified", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const readFile = vi.fn().mockResolvedValue("old content");
    const host = fakeHost({ readFile, writeFile });
    let capturedTools: Record<string, HostToolHandler> | undefined;
    const runSession = vi.fn(async (call: RunSessionCall) => {
      capturedTools = call.hostTools;
      // Simulate the model calling write_file itself during the session.
      await capturedTools!.write_file({ path: "/workspace/a.ts", content: "new content" }, new AbortController().signal);
      return transcriptWith("Wrote the merged version.");
    });
    const result = await reconciliateGraphDefinition.orchestrate?.({
      input: input({ nodes: [{ id: "t1", modifiedFiles: ["a.ts"] }], duplicateFiles: { "a.ts": ["t1"] } }),
      host,
      onEvent: () => {},
      signal: new AbortController().signal,
      runSession,
    });
    // write_file itself (via the tool) is the only write -- no extra
    // finalization read/write for a file the model already modified.
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith("/workspace/a.ts", "new content", expect.anything());
    expect(result).toMatchObject({ reconciledFiles: ["/workspace/a.ts"], modifiedFiles: ["/workspace/a.ts"] });
  });

  it("orchestrate() aborts on the first file's failure, emits file_error, and never reaches the second file", async () => {
    const host = fakeHost();
    const events: unknown[] = [];
    let callCount = 0;
    const runSession = vi.fn(async () => {
      callCount += 1;
      throw new Error("provider rejected the request");
    });
    await expect(
      reconciliateGraphDefinition.orchestrate?.({
        input: input({
          nodes: [
            { id: "t1", modifiedFiles: ["a.ts"] },
            { id: "t2", modifiedFiles: ["b.ts"] },
          ],
          duplicateFiles: { "a.ts": ["t1"], "b.ts": ["t2"] },
        }),
        host,
        onEvent: (e) => events.push(e),
        signal: new AbortController().signal,
        runSession,
      }),
    ).rejects.toThrow(/Failed while reconciling .*a\.ts.*provider rejected the request/);
    expect(callCount).toBe(1);
    expect(events).toContainEqual({
      kind: "file_error",
      filePath: "/workspace/a.ts",
      taskIds: ["t1"],
      error: "provider rejected the request",
    });
  });

  it("the per-file write_file tool refuses to touch any path other than the one it was scoped to", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const host = fakeHost({ readFile: vi.fn().mockResolvedValue("x"), writeFile });
    let capturedTools: Record<string, HostToolHandler> | undefined;
    const runSession = vi.fn(async (call: RunSessionCall) => {
      capturedTools = call.hostTools;
      return transcriptWith("done");
    });
    await reconciliateGraphDefinition.orchestrate?.({
      input: input({ nodes: [{ id: "t1", modifiedFiles: ["a.ts"] }], duplicateFiles: { "a.ts": ["t1"] } }),
      host,
      onEvent: () => {},
      signal: new AbortController().signal,
      runSession,
    });
    writeFile.mockClear();
    const outcome = await capturedTools!.write_file({ path: "/workspace/other.ts", content: "sneaky" }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: "This reconciliation case can only change /workspace/a.ts" });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("the per-file write_file tool is a no-op when the content is already identical", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const host = fakeHost({ readFile: vi.fn().mockResolvedValue("same"), writeFile });
    let capturedTools: Record<string, HostToolHandler> | undefined;
    const runSession = vi.fn(async (call: RunSessionCall) => {
      capturedTools = call.hostTools;
      return transcriptWith("done");
    });
    await reconciliateGraphDefinition.orchestrate?.({
      input: input({ nodes: [{ id: "t1", modifiedFiles: ["a.ts"] }], duplicateFiles: { "a.ts": ["t1"] } }),
      host,
      onEvent: () => {},
      signal: new AbortController().signal,
      runSession,
    });
    writeFile.mockClear();
    const outcome = await capturedTools!.write_file({ path: "/workspace/a.ts", content: "same" }, new AbortController().signal);
    expect(outcome).toEqual({ ok: true, output: "No write was needed because /workspace/a.ts already has that content." });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("usageContext() carries the run's workspaceRoot and model", () => {
    expect(reconciliateGraphDefinition.usageContext(input())).toEqual({ workspaceRoot: "/workspace", model: "claude-opus-4-20250514" });
  });
});
