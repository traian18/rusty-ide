import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { TestBuildInput } from "../../contract";
import type { HostToolHandler } from "../CoreHarness";
import type { SessionRecipe } from "../SessionRecipe";
import { createTranscript } from "../transcript";
import { testBuildDefinition } from "./test_build";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function input(overrides: Partial<TestBuildInput> = {}): TestBuildInput {
  return {
    tabId: "tab-1",
    buildCommand: "npm run build",
    workspaceRoot: "/workspace",
    reconciledFiles: ["/workspace/src/a.ts"],
    model: "claude-opus-4-20250514",
    customProvider: {
      id: "p1",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      models: [],
    },
    ...overrides,
  };
}

type RunSessionCall = { recipe: SessionRecipe; promptText: string; hostTools?: Record<string, HostToolHandler>; onLog?: (message: string) => void };

/** Routes invoke() calls by Tauri command name -- run_shell_command
 * answers get consumed from `buildQueue` in order (one per call, falling
 * back to the last entry once exhausted); read_file_disk/write_file_disk
 * operate against `disk`, a plain in-memory path->content map. */
function mockInvoke(buildQueue: Array<{ exit_code: number | null; output: string; timed_out: boolean }>, disk: Record<string, string> = {}) {
  invokeMock.mockImplementation((async (command: string, args?: Record<string, unknown>) => {
    if (command === "run_shell_command") {
      return buildQueue.length > 1 ? buildQueue.shift() : buildQueue[0];
    }
    if (command === "read_file_disk") {
      const path = String(args?.path);
      if (!(path in disk)) throw new Error(`File not found: ${path}`);
      return disk[path];
    }
    if (command === "write_file_disk") {
      disk[String(args?.path)] = String(args?.content);
      return undefined;
    }
    throw new Error(`unexpected invoke: ${command}`);
  }) as typeof invoke);
}

describe("testBuildDefinition", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("supports() is true for a provider that maps to the host-routed backend", () => {
    expect(testBuildDefinition.supports?.(input())).toBe(true);
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
    expect(testBuildDefinition.supports?.(withUnmapped)).toBe(false);
  });

  it("orchestrate() throws for an unsupported provider before touching invoke", async () => {
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
      testBuildDefinition.orchestrate?.({ input: withUnmapped, host: {} as never, onEvent: () => {}, signal: new AbortController().signal, runSession }),
    ).rejects.toThrow(/cannot run on core/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("orchestrate() throws when no build command is provided", async () => {
    const runSession = vi.fn();
    await expect(
      testBuildDefinition.orchestrate?.({ input: input({ buildCommand: "   " }), host: {} as never, onEvent: () => {}, signal: new AbortController().signal, runSession }),
    ).rejects.toThrow(/No build command provided/);
  });

  it("orchestrate() throws when there are no reconciled files to test", async () => {
    const runSession = vi.fn();
    await expect(
      testBuildDefinition.orchestrate?.({ input: input({ reconciledFiles: [] }), host: {} as never, onEvent: () => {}, signal: new AbortController().signal, runSession }),
    ).rejects.toThrow(/No reconciled files to test/);
  });

  it("orchestrate() returns success on the first passing attempt, with finalFiles read from disk, and never calls runSession", async () => {
    mockInvoke([{ exit_code: 0, output: "Build succeeded.", timed_out: false }], { "/workspace/src/a.ts": "export {}" });
    const events: unknown[] = [];
    const runSession = vi.fn();
    const result = await testBuildDefinition.orchestrate?.({
      input: input(),
      host: {} as never,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
      runSession,
    });
    expect(result).toEqual({ success: true, attempts: 1, finalFiles: { "/workspace/src/a.ts": "export {}" } });
    expect(runSession).not.toHaveBeenCalled();
    expect(events).toContainEqual({ kind: "iteration", attempt: 1, maxAttempts: 5 });
    expect(events).toContainEqual({ kind: "log", message: "Build passed after 1 attempt." });
    expect(invokeMock).toHaveBeenCalledWith("run_shell_command", { program: "npm", args: ["run", "build"], cwd: "/workspace", timeoutMs: 300_000 });
  });

  it("orchestrate() calls runSession() with a disk-bound recipe and the build output in the prompt when the build fails and attempts remain", async () => {
    mockInvoke(
      [
        { exit_code: 1, output: "TS2304: Cannot find name 'foo'.", timed_out: false },
        { exit_code: 0, output: "Build succeeded.", timed_out: false },
      ],
      { "/workspace/src/a.ts": "fixed" },
    );
    const calls: RunSessionCall[] = [];
    const runSession = vi.fn(async (call: RunSessionCall) => {
      calls.push(call);
      return createTranscript();
    });
    const result = await testBuildDefinition.orchestrate?.({
      input: input(),
      host: {} as never,
      onEvent: () => {},
      signal: new AbortController().signal,
      runSession,
    });
    expect(runSession).toHaveBeenCalledTimes(1);
    const call = calls[0];
    expect(call.recipe.workspace).toEqual({ root: "/workspace", binding: "disk" });
    expect(call.recipe.host_tools?.map((t) => t.name).sort()).toEqual(["read_file", "run_command", "write_file"]);
    expect(call.recipe.system_prompt).toContain("build error fixer");
    expect(call.recipe.system_prompt).toContain("/workspace/src/a.ts");
    expect(call.promptText).toContain("TS2304: Cannot find name 'foo'.");
    expect(result).toEqual({ success: true, attempts: 2, finalFiles: { "/workspace/src/a.ts": "fixed" } });
  });

  it("orchestrate() breaks without calling runSession() on the final attempt's failure, reporting success:false", async () => {
    mockInvoke([{ exit_code: 1, output: "still broken", timed_out: false }], { "/workspace/src/a.ts": "broken" });
    const runSession = vi.fn(async () => createTranscript());
    const events: unknown[] = [];
    const result = await testBuildDefinition.orchestrate?.({
      input: input(),
      host: {} as never,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
      runSession,
    });
    expect(runSession).toHaveBeenCalledTimes(4); // attempts 1-4 fail and get a fix session; attempt 5 fails and breaks
    expect(result).toEqual({ success: false, attempts: 5, finalFiles: { "/workspace/src/a.ts": "broken" } });
    expect(events).toContainEqual({ kind: "log", message: "Build did not pass after 5 attempts." });
  });

  it("the fix session's write_file tool refuses a path outside the reconciled file set", async () => {
    mockInvoke(
      [
        { exit_code: 1, output: "broken", timed_out: false },
        { exit_code: 0, output: "ok", timed_out: false },
      ],
      { "/workspace/src/a.ts": "x" },
    );
    let capturedTools: Record<string, HostToolHandler> | undefined;
    const runSession = vi.fn(async (call: RunSessionCall) => {
      capturedTools = call.hostTools;
      return createTranscript();
    });
    await testBuildDefinition.orchestrate?.({
      input: input(),
      host: {} as never,
      onEvent: () => {},
      signal: new AbortController().signal,
      runSession,
    });
    const outcome = await capturedTools!.write_file({ path: "/workspace/src/unreconciled.ts", content: "sneaky" }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: "Only reconciled files may be modified. '/workspace/src/unreconciled.ts' is not in scope." });
  });

  it("usageContext() carries the run's workspaceRoot and model", () => {
    expect(testBuildDefinition.usageContext(input())).toEqual({ workspaceRoot: "/workspace", model: "claude-opus-4-20250514" });
  });
});
