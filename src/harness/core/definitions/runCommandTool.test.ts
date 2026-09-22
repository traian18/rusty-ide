import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { CapabilityEvent, CommandPermissionRequest, RunHost } from "../../contract";
import { DEFAULT_TIMEOUT_MS, GATED_RUN_COMMAND_TOOL, MAX_TIMEOUT_MS, MAX_TOOL_OUTPUT_CHARS, gatedRunCommandTool, normalizeCommand } from "./runCommandTool";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function fakeHost(decision: "deny" | "allow_once" | "allow_session" | Error = "allow_once"): RunHost & { requests: CommandPermissionRequest[] } {
  const requests: CommandPermissionRequest[] = [];
  return {
    requests,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    requestPermission: vi.fn(async (request: CommandPermissionRequest) => {
      requests.push(request);
      if (decision instanceof Error) throw decision;
      return decision;
    }),
  };
}

function tool(host: RunHost, events: CapabilityEvent<"agent_chat">[] = []) {
  return gatedRunCommandTool({ workspaceRoot: "/workspace", sessionId: "tab-1", host, onEvent: (event) => events.push(event) });
}

describe("GATED_RUN_COMMAND_TOOL", () => {
  it("is the structured program/args shape, not a sh -c string", () => {
    expect(GATED_RUN_COMMAND_TOOL.name).toBe("run_command");
    const schema = GATED_RUN_COMMAND_TOOL.input_schema as { properties: object; required: string[] };
    expect(Object.keys(schema.properties).sort()).toEqual(["args", "cwd", "program", "timeoutMs"]);
    expect(schema.required).toEqual(["program"]);
  });
});

describe("normalizeCommand", () => {
  it("defaults cwd to the workspace root and the timeout to five minutes", () => {
    expect(normalizeCommand({ program: "npm", args: ["test"] }, "/workspace")).toEqual({
      program: "npm",
      args: ["test"],
      cwd: "/workspace",
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  });

  it("resolves a relative cwd inside the workspace", () => {
    expect(normalizeCommand({ program: "ls", cwd: "src/../packages/./api" }, "/workspace/").cwd).toBe("/workspace/packages/api");
  });

  it("rejects a cwd that escapes the workspace, relative or absolute", () => {
    expect(() => normalizeCommand({ program: "ls", cwd: "../elsewhere" }, "/workspace")).toThrow(/inside the workspace/);
    expect(() => normalizeCommand({ program: "ls", cwd: "/etc" }, "/workspace")).toThrow(/inside the workspace/);
    // A sibling whose name merely starts with the root's is still outside.
    expect(() => normalizeCommand({ program: "ls", cwd: "/workspace-other" }, "/workspace")).toThrow(/inside the workspace/);
  });

  it("drops a repeated argv[0] so the dialog shows the command that will run", () => {
    expect(normalizeCommand({ program: "ls", args: ["ls", "-la"] }, "/workspace").args).toEqual(["-la"]);
    expect(normalizeCommand({ program: "/usr/bin/grep", args: ["grep", "-r", "x"] }, "/workspace").args).toEqual(["-r", "x"]);
  });

  it("clamps the timeout to [1s, 30min]", () => {
    expect(normalizeCommand({ program: "x", timeoutMs: 10 }, "/workspace").timeoutMs).toBe(1_000);
    expect(normalizeCommand({ program: "x", timeoutMs: 10 ** 9 }, "/workspace").timeoutMs).toBe(MAX_TIMEOUT_MS);
    expect(normalizeCommand({ program: "x", timeoutMs: "nope" }, "/workspace").timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("rejects a missing program, NUL bytes, and oversized argv", () => {
    expect(() => normalizeCommand({}, "/workspace")).toThrow(/program is required/);
    expect(() => normalizeCommand({ program: "  " }, "/workspace")).toThrow(/program is required/);
    expect(() => normalizeCommand({ program: "ls", args: ["a\0b"] }, "/workspace")).toThrow(/allowed limits/);
    expect(() => normalizeCommand({ program: "ls", args: new Array(257).fill("x") }, "/workspace")).toThrow(/allowed limits/);
    expect(() => normalizeCommand({ program: "ls" }, "  ")).toThrow(/workspace root/);
  });
});

describe("gatedRunCommandTool", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("asks the host with the classified risk/scope, keyed to the tab's session, and runs on allow_once", async () => {
    invokeMock.mockResolvedValue({ exit_code: 0, output: "ok\n", timed_out: false, cancelled: false });
    const host = fakeHost("allow_once");
    const events: CapabilityEvent<"agent_chat">[] = [];
    const signal = new AbortController().signal;

    const outcome = await tool(host, events)({ program: "grep", args: ["-r", "foo", "src"] }, signal);

    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]).toMatchObject({
      sessionId: "tab-1",
      command: { program: "grep", args: ["-r", "foo", "src"], cwd: "/workspace", timeoutMs: DEFAULT_TIMEOUT_MS },
      risk: "normal",
      sessionGrantScope: "executable",
      sessionGrantProgram: "grep",
      description: "The agent wants to run: grep -r foo src",
    });
    expect(host.requests[0].requestId).toMatch(/[0-9a-f-]{36}/);
    expect(vi.mocked(host.requestPermission).mock.calls[0][1]).toBe(signal);

    expect(invokeMock).toHaveBeenCalledWith("run_shell_command", {
      program: "grep",
      args: ["-r", "foo", "src"],
      cwd: "/workspace",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      executionId: expect.stringMatching(/[0-9a-f-]{36}/),
    });
    expect(outcome).toEqual({ ok: true, output: "ok\n(command exited with code 0)" });
    expect(events).toEqual([
      { kind: "log", message: "Running approved command: grep -r foo src" },
      { kind: "command_output", content: "ok\n" },
      { kind: "command_complete" },
      { kind: "log", message: "Command exited with code 0." },
    ]);
  });

  it("classifies a destructive command as exact-command scope in the request", async () => {
    invokeMock.mockResolvedValue({ exit_code: 0, output: "", timed_out: false, cancelled: false });
    const host = fakeHost("allow_session");
    await tool(host)({ program: "git", args: ["push", "--force"] }, new AbortController().signal);
    expect(host.requests[0]).toMatchObject({ risk: "destructive", sessionGrantScope: "exact_command", sessionGrantProgram: "git" });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("does not run a denied command", async () => {
    const host = fakeHost("deny");
    const events: CapabilityEvent<"agent_chat">[] = [];
    const outcome = await tool(host, events)({ program: "rm", args: ["-rf", "dist"] }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: "Command denied by the user." });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("does not run when the permission request itself fails", async () => {
    const host = fakeHost(new Error("no dialog available"));
    const outcome = await tool(host)({ program: "ls" }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: "no dialog available" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects malformed input before asking for permission", async () => {
    const host = fakeHost("allow_once");
    const outcome = await tool(host)({ program: "ls", cwd: "../.." }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("inside the workspace") });
    expect(host.requests).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports a timeout and a cancel in the model-facing status", async () => {
    invokeMock.mockResolvedValueOnce({ exit_code: null, output: "", timed_out: true, cancelled: false });
    expect(await tool(fakeHost())({ program: "sleep", args: ["999"] }, new AbortController().signal)).toEqual({
      ok: true,
      output: "(command timed out)",
    });

    invokeMock.mockResolvedValueOnce({ exit_code: null, output: "partial", timed_out: false, cancelled: true });
    expect(await tool(fakeHost())({ program: "sleep", args: ["999"] }, new AbortController().signal)).toEqual({
      ok: true,
      output: "partial\n(command cancelled)",
    });
  });

  it("truncates long output for the model, keeping the tail, but sends the full text to the console", async () => {
    const longOutput = "x".repeat(MAX_TOOL_OUTPUT_CHARS + 500);
    invokeMock.mockResolvedValue({ exit_code: 1, output: longOutput, timed_out: false, cancelled: false });
    const events: CapabilityEvent<"agent_chat">[] = [];
    const outcome = await tool(fakeHost(), events)({ program: "cat", args: ["big.log"] }, new AbortController().signal);
    if (!outcome.ok) throw new Error("expected ok");
    expect(String(outcome.output)).toContain("...(truncated)...");
    expect(String(outcome.output)).toContain("(command exited with code 1)");
    expect(String(outcome.output).length).toBeLessThan(longOutput.length);
    expect(events.find((e) => e.kind === "command_output")).toEqual({ kind: "command_output", content: longOutput });
  });

  it("reports a spawn failure as an error outcome and logs it", async () => {
    invokeMock.mockRejectedValue(new Error("Failed to start 'nope': No such file or directory"));
    const events: CapabilityEvent<"agent_chat">[] = [];
    const outcome = await tool(fakeHost(), events)({ program: "nope" }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: "Failed to start 'nope': No such file or directory" });
    expect(events.at(-1)).toEqual({ kind: "log", message: "Command failed to start: Failed to start 'nope': No such file or directory" });
  });
});
