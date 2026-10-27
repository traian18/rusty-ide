import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

import type { HostToolHandler } from "../CoreHarness";
import { CommandJobs, backgroundable, withJobNotices, type JobWork } from "./commandJobs";

const signal = new AbortController().signal;
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** A job whose work finishes when told to, reporting `result`. */
function gated(result: { ok: true; output: string } | { ok: false; error: string }) {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const seen: { signal?: AbortSignal } = {};
  const work: JobWork = async (jobSignal, track) => {
    seen.signal = jobSignal;
    track("exec-1");
    await Promise.race([finished, new Promise((resolve) => jobSignal.addEventListener("abort", resolve))]);
    if (jobSignal.aborted) return { ok: false, error: "cancelled" };
    return result;
  };
  return { work, finish, seen };
}

describe("background jobs", () => {
  beforeEach(() => invokeMock.mockReset());

  it("starts a job and answers at once, saying how to follow it", () => {
    const jobs = new CommandJobs(() => undefined);
    const started = jobs.start("run_check test (rusty-core)", gated({ ok: true, output: "PASSED" }).work, 631_000);
    if (!started.ok) throw new Error("expected a start");
    expect(started.output).toContain("Started job-1 in the background: run_check test (rusty-core). It took 10m31s last time.");
    expect(started.output).toContain('job_output with id "job-1"');
    expect(started.output).toContain("stopped when this step ends");
  });

  it("reads what a running job printed so far, from its current command", async () => {
    invokeMock.mockResolvedValue({ output: "Compiling a\nrunning 180 tests\n", log_path: "/tmp/rusty-commands/9.log", elapsed_ms: 4_000 });
    const jobs = new CommandJobs(() => undefined);
    jobs.start("run_check test", gated({ ok: true, output: "PASSED" }).work);
    await tick();
    const read = await jobs.handler()({ id: "job-1" }, signal);
    if (!read.ok) throw new Error(String(read.error));
    expect(read.output).toContain("job-1 (run_check test) is still running");
    expect(read.output).toContain("running 180 tests");
    expect(read.output).toContain("Full output so far: /tmp/rusty-commands/9.log");
    expect(invokeMock).toHaveBeenCalledWith("shell_command_progress", { executionId: "exec-1" });
  });

  it("waits for a job when asked, and gives its result as its own: a failed check is a failed call", async () => {
    const jobs = new CommandJobs(() => undefined);
    const { work, finish } = gated({ ok: false, error: "test for rusty-core: FAILED\n  1 error" });
    jobs.start("run_check test", work);
    setTimeout(finish, 20);
    const read = await jobs.handler()({ id: "job-1", wait_seconds: 5 }, signal);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(String(read.error)).toMatch(/^job-1 \(run_check test\) finished after \d+s\.\ntest for rusty-core: FAILED/);
    // Read in full, so it is not announced again.
    expect(jobs.notices()).toEqual([]);
  });

  it("tells the model once, in its next tool result, that a job finished", async () => {
    const jobs = new CommandJobs(() => undefined);
    const { work, finish } = gated({ ok: true, output: "test for rusty-core: PASSED\n180 passed" });
    jobs.start("run_check test", work);
    const read: HostToolHandler = async () => ({ ok: true, output: "file contents" });
    const tool = withJobNotices(read, jobs);
    expect(await tool({}, signal)).toEqual({ ok: true, output: "file contents" });
    finish();
    await tick();
    const next = await tool({}, signal);
    if (!next.ok) throw new Error("expected ok");
    expect(next.output).toMatch(/^file contents\n\n\[Background job-1 \(run_check test\) finished after \d+s: test for rusty-core: PASSED\. Call job_output/);
    expect(await tool({}, signal)).toEqual({ ok: true, output: "file contents" });
  });

  it("cancels a job when the step that started it ends, and every job when the run ends", async () => {
    let step = "build";
    const run = new AbortController();
    const jobs = new CommandJobs(() => step, run.signal);
    const first = gated({ ok: true, output: "done" });
    jobs.start("run_check test", first.work);
    step = "verify";
    const second = gated({ ok: true, output: "done" });
    jobs.start("run_check build", second.work);
    jobs.cancelOutside("verify");
    expect(first.seen.signal?.aborted).toBe(true);
    expect(second.seen.signal?.aborted).toBe(false);
    run.abort();
    expect(second.seen.signal?.aborted).toBe(true);
  });

  it("lists the jobs when no id is given, and says which do not exist", async () => {
    const jobs = new CommandJobs(() => undefined);
    expect(await jobs.handler()({}, signal)).toEqual({ ok: true, output: "No background jobs were started." });
    jobs.start("run_command cargo test", gated({ ok: true, output: "" }).work);
    const listed = await jobs.handler()({}, signal);
    expect(listed.ok && listed.output).toMatch(/- job-1: run_command cargo test, running for \d+s/);
    const missing = await jobs.handler()({ id: "job-7" }, signal);
    expect(missing.ok).toBe(false);
  });
});

describe("a tool that can run in the background", () => {
  it("runs in the foreground unless asked, and as a job without the background flag when asked", async () => {
    const calls: { args: unknown; tracked: boolean }[] = [];
    const make = (onExecution?: (id: string) => void): HostToolHandler => async (args) => {
      calls.push({ args, tracked: onExecution !== undefined });
      return { ok: true, output: "ran" };
    };
    const jobs = new CommandJobs(() => undefined);
    const tool = backgroundable(make, (args) => `run_check ${String(args.check)}`, jobs);

    expect(await tool({ check: "test" }, signal)).toEqual({ ok: true, output: "ran" });
    const started = await tool({ check: "test", background: true }, signal);
    expect(started.ok && started.output).toContain("Started job-1 in the background: run_check test.");
    await tick();
    expect(calls).toEqual([
      { args: { check: "test" }, tracked: false },
      { args: { check: "test" }, tracked: true },
    ]);
  });
});
