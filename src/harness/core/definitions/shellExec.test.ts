import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { runCommandTool, runShellCommand } from "./shellExec";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const signal = new AbortController().signal;

describe("runShellCommand", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes run_shell_command with the given program/args/cwd/timeout", async () => {
    invokeMock.mockResolvedValue({ exit_code: 0, output: "ok", timed_out: false });
    const result = await runShellCommand("npm", ["run", "build"], "/workspace", 5_000);
    expect(invokeMock).toHaveBeenCalledWith("run_shell_command", { program: "npm", args: ["run", "build"], cwd: "/workspace", timeoutMs: 5_000 });
    expect(result).toEqual({ exit_code: 0, output: "ok", timed_out: false });
  });

  it("with a signal, registers an execution id and cancels through it on abort", async () => {
    let settle!: (value: unknown) => void;
    invokeMock.mockImplementation((command) => {
      if (command === "run_shell_command") return new Promise((resolve) => (settle = resolve));
      return Promise.resolve(true);
    });
    const controller = new AbortController();
    const pending = runShellCommand("sleep", ["30"], "/workspace", 60_000, controller.signal);
    const runArgs = invokeMock.mock.calls[0][1] as { executionId?: string };
    expect(typeof runArgs.executionId).toBe("string");

    controller.abort();
    expect(invokeMock).toHaveBeenCalledWith("cancel_shell_command", { executionId: runArgs.executionId });

    settle({ exit_code: null, output: "", timed_out: false, cancelled: true });
    expect(await pending).toEqual({ exit_code: null, output: "", timed_out: false, cancelled: true });
  });

  it("with an already-aborted signal, reports cancelled without invoking anything", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runShellCommand("sleep", ["30"], "/workspace", 60_000, controller.signal);
    expect(result).toEqual({ exit_code: null, output: "", timed_out: false, cancelled: true });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not cancel after the command has already finished", async () => {
    invokeMock.mockResolvedValue({ exit_code: 0, output: "done", timed_out: false, cancelled: false });
    const controller = new AbortController();
    await runShellCommand("echo", ["hi"], "/workspace", 5_000, controller.signal);
    controller.abort();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("run_shell_command");
  });
});

describe("runCommandTool", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("wraps the command in sh -c and reports the exit code", async () => {
    invokeMock.mockResolvedValue({ exit_code: 0, output: "src/a.ts\nsrc/b.ts\n", timed_out: false });
    const tool = runCommandTool("/workspace");
    const outcome = await tool({ command: "ls src" }, signal);
    expect(invokeMock).toHaveBeenCalledWith("run_shell_command", { program: "sh", args: ["-c", "ls src"], cwd: "/workspace", timeoutMs: 60_000 });
    expect(outcome).toEqual({ ok: true, output: "src/a.ts\nsrc/b.ts\n (exit 0)" });
  });

  it("reports a nonzero exit code and a timeout in the output text", async () => {
    invokeMock.mockResolvedValue({ exit_code: null, output: "", timed_out: true });
    const tool = runCommandTool("/workspace");
    const outcome = await tool({ command: "sleep 120" }, signal);
    expect(outcome).toEqual({ ok: true, output: " (timed out)" });
  });

  it("truncates output over the cap, keeping the tail", async () => {
    const longOutput = "x".repeat(9_000);
    invokeMock.mockResolvedValue({ exit_code: 1, output: longOutput, timed_out: false });
    const tool = runCommandTool("/workspace");
    const outcome = await tool({ command: "cat big.log" }, signal);
    if (!outcome.ok) throw new Error("expected ok");
    expect(String(outcome.output)).toContain("...(truncated)...");
    expect(String(outcome.output)).toContain(longOutput.slice(-100));
  });

  it("rejects a missing command without invoking the shell", async () => {
    const tool = runCommandTool("/workspace");
    const outcome = await tool({}, signal);
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("command") });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports an invoke failure as an error outcome", async () => {
    invokeMock.mockRejectedValue(new Error("no such shell"));
    const tool = runCommandTool("/workspace");
    const outcome = await tool({ command: "ls" }, signal);
    expect(outcome).toEqual({ ok: false, error: "no such shell" });
  });
});
