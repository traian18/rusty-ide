/**
 * A minimal counting semaphore -- bookkeeping only, no timers or I/O, so
 * it's testable directly. Used by providerCoordinator.ts (which cannot
 * live under src/integrations/ itself -- it imports the store and
 * llmIntegrationService, which this directory's layering.test.ts
 * forbids) to bound how many sidecar status/discovery/quota checks run at
 * once: Copilot's status check can cold-start a whole SDK client, Codex
 * spawns a child process, and Claude Code's probe can shell out twice --
 * three of those firing unbounded at every launch is the "PBKDF2 storm"'s
 * sibling problem on the network side (REFACTOR_PLAN.md PR 3b).
 */
export interface Semaphore {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createSemaphore(maxConcurrent: number): Semaphore {
  let currentActiveCount = 0; // Track the number of currently active tasks
  const waitingQueue: Array<() => void> = []; // Queue of waiting tasks

  // Function to acquire a permit to run a task
  function acquire(): Promise<void> {
    if (currentActiveCount < maxConcurrent) {
      currentActiveCount++;
      return Promise.resolve(); // Immediately grant permit if under limit
    }
    return new Promise<void>((resolve) => {
      waitingQueue.push(() => {
        currentActiveCount++;
        resolve(); // Resolve when the permit is available
      });
    });
  }

  // Function to release a permit after task completion
  function release(): void {
    currentActiveCount--; // Decrease active task count
    const nextTask = waitingQueue.shift(); // Get the next waiting task
    if (nextTask) nextTask(); // Grant permit to the next task if available
  }

  return {
    // Run a task with semaphore control
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire(); // Acquire permit before running the task
      try {
        return await task(); // Execute the task
      } finally {
        release(); // Ensure release of the permit when done
      }
    },
  };
}
