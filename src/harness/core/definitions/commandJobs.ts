// ============================================================
// definitions/commandJobs.ts -- checks and commands run in the background.
//
// A full test run can take ten minutes. With `background: true` on run_check
// or run_command the call starts it as a job and returns at once, so the
// model keeps working; `job_output` reads what the job printed so far or
// waits for it, and when a job finishes a line saying so is added to the
// result of the model's next tool call (it never has to poll).
//
// A job belongs to the run, and inside a workflow to the step that started
// it: it is cancelled when that step ends or the run ends, so nothing keeps
// running for a conversation that has moved on.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";
import { formatDuration } from "../checkHistory";

type Outcome = Awaited<ReturnType<HostToolHandler>>;

/** Starts the job's work: `track` is told each command execution it starts, so its output can be read while it runs. */
export type JobWork = (signal: AbortSignal, track: (executionId: string) => void) => Promise<Outcome>;

interface Job {
  id: string;
  label: string;
  step?: string;
  startedAt: number;
  finishedAt?: number;
  controller: AbortController;
  /** The command execution running now, when one is. */
  execution?: string;
  result?: Outcome;
  /** The model has been told it finished. */
  announced: boolean;
  done: Promise<Outcome>;
}

interface CommandProgress {
  output: string;
  log_path?: string | null;
  elapsed_ms: number;
}

/** The longest a `job_output` call may wait. */
export const MAX_JOB_WAIT_SECONDS = 30 * 60;
const PROGRESS_LINES = 40;

export const JOB_OUTPUT_TOOL: HostToolSpec = {
  name: "job_output",
  description:
    "Read a background job started by run_check or run_command with background: true. Returns its result when it has finished; otherwise what it printed so far and how long it has run. Give wait_seconds to wait for it to finish (up to 1800) when you have nothing else to do meanwhile. Without an id, lists the jobs of this step.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The job id the starting call returned, such as job-1." },
      wait_seconds: { type: "number", description: "How long to wait for it to finish before answering with its progress; 0 (the default) answers at once." },
    },
    required: [],
  },
};

const asText = (value: unknown) => (typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value));
const firstLine = (text: string) => text.split("\n").find((line) => line.trim()) ?? "";
const tail = (text: string, lines: number) => text.split("\n").slice(-lines).join("\n").trimEnd();

export class CommandJobs {
  private readonly jobs = new Map<string, Job>();
  private next = 1;

  /** `currentStep` names the workflow step running now, if any. */
  constructor(private readonly currentStep: () => string | undefined, runSignal?: AbortSignal) {
    runSignal?.addEventListener("abort", () => this.cancelAll(), { once: true });
  }

  /** Starts `work` as a job and returns what the starting call answers. */
  start(label: string, work: JobWork, usualMs?: number): Outcome {
    const id = `job-${this.next++}`;
    const controller = new AbortController();
    const job: Job = { id, label, step: this.currentStep(), startedAt: Date.now(), controller, announced: false, done: Promise.resolve({ ok: true, output: "" }) };
    job.done = work(controller.signal, (execution) => { job.execution = execution; })
      .catch((error: unknown): Outcome => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      .then((result) => {
        job.result = result;
        job.finishedAt = Date.now();
        job.execution = undefined;
        return result;
      });
    this.jobs.set(id, job);
    const usually = usualMs !== undefined ? ` It took ${formatDuration(usualMs)} last time.` : "";
    return {
      ok: true,
      output: [
        `Started ${id} in the background: ${label}.${usually}`,
        "Keep working on what does not depend on it. When it finishes, a line saying so is added to the result of your next tool call;",
        `call job_output with id "${id}" to read its output so far, or with wait_seconds to wait for it when you have nothing else to do.`,
        "Jobs are stopped when this step ends, so collect the result before you finish.",
      ].join("\n"),
    };
  }

  /** The `job_output` tool. */
  handler(): HostToolHandler {
    return async (args, signal) => {
      const input = (args ?? {}) as { id?: unknown; wait_seconds?: unknown };
      const id = typeof input.id === "string" ? input.id.trim() : "";
      if (!id) return { ok: true, output: this.list() };
      const job = this.jobs.get(id);
      if (!job) return { ok: false, error: `No job ${id}. ${this.list()}` };
      const seconds = Number(input.wait_seconds);
      const waitMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_JOB_WAIT_SECONDS) * 1000 : 0;
      if (!job.result && waitMs > 0) await this.waitFor(job, waitMs, signal);
      if (job.result) {
        job.announced = true;
        return this.finished(job);
      }
      return { ok: true, output: await this.progress(job) };
    };
  }

  /** Lines for jobs that finished since the model last heard of them, marked as told. */
  notices(): string[] {
    const lines: string[] = [];
    for (const job of this.jobs.values()) {
      if (!job.result || job.announced) continue;
      job.announced = true;
      const verdict = firstLine(asText(job.result.ok ? job.result.output : job.result.error));
      lines.push(`[Background ${job.id} (${job.label}) finished after ${formatDuration(this.elapsed(job))}: ${verdict || (job.result.ok ? "done" : "failed")}. Call job_output with id "${job.id}" for its full result.]`);
    }
    return lines;
  }

  /** Cancels the jobs a step other than `step` started: that step has ended. */
  cancelOutside(step: string): void {
    for (const job of this.jobs.values()) {
      if (job.step !== undefined && job.step !== step && !job.result) job.controller.abort();
    }
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) if (!job.result) job.controller.abort();
  }

  private finished(job: Job): Outcome {
    const head = `${job.id} (${job.label}) finished after ${formatDuration(this.elapsed(job))}.`;
    const result = job.result!;
    return result.ok ? { ok: true, output: `${head}\n${asText(result.output)}` } : { ok: false, error: `${head}\n${asText(result.error)}` };
  }

  private async progress(job: Job): Promise<string> {
    const running = `${job.id} (${job.label}) is still running after ${formatDuration(this.elapsed(job))}.`;
    if (!job.execution) return `${running} No command is running yet: it may be waiting for the user to approve it.`;
    const progress = await invoke<CommandProgress | null>("shell_command_progress", { executionId: job.execution }).catch(() => null);
    if (!progress) return `${running} Its current command is just finishing; ask again in a moment.`;
    const shown = tail(progress.output, PROGRESS_LINES);
    return [
      running,
      shown ? `Output so far (last lines):\n${shown}` : "It has printed nothing yet.",
      progress.log_path ? `Full output so far: ${progress.log_path}` : undefined,
      `Call job_output with id "${job.id}" and wait_seconds to wait for it, or keep working; you will be told when it finishes.`,
    ].filter(Boolean).join("\n");
  }

  private waitFor(job: Job, waitMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      const stop = () => { clearTimeout(timer); resolve(); };
      signal.addEventListener("abort", stop, { once: true });
      void job.done.then(() => {
        signal.removeEventListener("abort", stop);
        stop();
      });
    });
  }

  private list(): string {
    const jobs = [...this.jobs.values()];
    if (jobs.length === 0) return "No background jobs were started.";
    return ["Background jobs:", ...jobs.map((job) => `- ${job.id}: ${job.label}, ${job.result ? (job.result.ok ? "finished" : "finished, failed") : `running for ${formatDuration(this.elapsed(job))}`}`)].join("\n");
  }

  private elapsed(job: Job): number {
    return (job.finishedAt ?? Date.now()) - job.startedAt;
  }
}

/** The job registry of a run: one per run, shared by its tools and its workflow driver. */
export function runJobs(scratch: Record<string, unknown>, currentStep: () => string | undefined, runSignal?: AbortSignal): CommandJobs {
  return (scratch.commandJobs ??= new CommandJobs(currentStep, runSignal)) as CommandJobs;
}

/** Adds the notices of jobs that finished meanwhile to a tool's result. */
export function withJobNotices(handler: HostToolHandler, jobs: CommandJobs): HostToolHandler {
  return async (...args) => {
    const result = await handler(...args);
    const notices = jobs.notices();
    if (notices.length === 0) return result;
    const added = `\n\n${notices.join("\n")}`;
    return result.ok ? { ok: true, output: `${asText(result.output)}${added}` } : { ok: false, error: `${asText(result.error)}${added}` };
  };
}

/**
 * `make`'s tool, which runs as a job when called with `background: true`.
 * `make` builds the tool, told the executions a job starts.
 */
export function backgroundable(
  make: (onExecution?: (executionId: string) => void) => HostToolHandler,
  label: (args: Record<string, unknown>) => string,
  jobs: CommandJobs,
): HostToolHandler {
  const foreground = make();
  return async (args, signal, ...rest) => {
    const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    if (input.background !== true) return foreground(args, signal, ...rest);
    const { background: _background, ...work } = input;
    return jobs.start(label(work), (jobSignal, track) => make(track)(work, jobSignal));
  };
}
