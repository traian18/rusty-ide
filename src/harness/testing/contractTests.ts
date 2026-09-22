// ============================================================
// contractTests.ts — The behavioral suite any AgentHarness backend must
// pass, parameterized over a ContractCase that knows how to drive that
// specific backend's stimulus (direct calls for FakeHarness; wire messages
// over a FakeTransport for SidecarHarness; Tauri IPC events for CoreHarness
// once it exists).
//
// Fixed on the "inline_chat" capability throughout: it is the smallest
// capability (no tools in its real definition), and the point of this
// suite is to prove the RunHandle/RunHost/terminal-outcome *mechanism*
// works, not to re-test every capability's own event shape.
// ============================================================

import { describe, expect, it } from "vitest";
import type { AgentHarness, CapabilityEvent, RunHandle } from "../contract";

export interface ContractDriver {
  /** Backend-side: cause the run's `started` promise to resolve. */
  acceptStart(): void | Promise<void>;
  /** Backend-side: issue a host `readFile`/`writeFile` request. Resolves
   * once the request has been issued to the RunHost (not once answered). */
  requestRead(path: string): void | Promise<void>;
  requestWrite(path: string, content: string): void | Promise<void>;
  /** Backend-side: issue a host `requestPermission` call that the test's
   * RunHost (testing/recordingHost.ts) leaves pending until aborted. */
  requestPermission(): void | Promise<void>;
  /** Backend-side: emit one "token" event -- every capability streams
   * tokens, unlike "log", which not every capability's binding maps. */
  emitToken(content: string): void | Promise<void>;
  /** Backend-side: report the run's successful/failed terminal outcome. */
  finishWithResult(response: string): void | Promise<void>;
  finishWithFailure(message: string): void | Promise<void>;
}

export interface ContractRun {
  harness: AgentHarness;
  handle: RunHandle<"inline_chat">;
  driver: ContractDriver;
  /** Populated as the harness delivers events to onEvent, in delivery order. */
  events: CapabilityEvent<"inline_chat">[];
  /** The RunHost calls this run's backend made, in order (see
   * testing/recordingHost.ts). */
  hostCalls: string[];
}

export interface ContractCase {
  name: string;
  /** Builds one fresh inline_chat run against the harness under test. */
  start(): ContractRun;
}

export function describeAgentHarnessContract(testCase: ContractCase): void {
  describe(`AgentHarness contract (${testCase.name})`, () => {
    it("resolves `started` before `done`, on a successful run", async () => {
      const { handle, driver } = testCase.start();
      await driver.acceptStart();
      await handle.started; // must resolve on its own, however many internal ticks the backend needs

      let doneSettled = false;
      void handle.done.then(() => {
        doneSettled = true;
      });
      await Promise.resolve();
      expect(doneSettled).toBe(false); // `done` has no way to settle yet -- nothing has finished the run

      await driver.finishWithResult("hello");
      const outcome = await handle.done;
      expect(outcome).toEqual({ status: "completed", result: { response: "hello" } });
    });

    it("delivers backend events to onEvent", async () => {
      const { handle, driver, events } = testCase.start();
      await driver.acceptStart();
      await driver.emitToken("working");
      await driver.finishWithResult("done");
      await handle.done;
      expect(events).toContainEqual({ kind: "token", content: "working" });
    });

    it("routes host read/write requests through RunHost, in order", async () => {
      const { handle, driver, hostCalls } = testCase.start();
      await driver.acceptStart();
      await driver.requestRead("/a.txt");
      await driver.requestWrite("/b.txt", "content");
      await driver.finishWithResult("done");
      await handle.done;
      expect(hostCalls).toEqual(["read:/a.txt", "write:/b.txt"]);
    });

    it("cancel() settles `done` as cancelled and aborts a pending host call", async () => {
      const { handle, driver, hostCalls } = testCase.start();
      await driver.acceptStart();
      await driver.requestPermission();
      handle.cancel();
      const outcome = await handle.done;
      expect(outcome).toEqual({ status: "cancelled" });
      expect(hostCalls).toContain("permission:aborted");
    });

    it("cancel() is idempotent", async () => {
      const { handle, driver } = testCase.start();
      await driver.acceptStart();
      handle.cancel();
      handle.cancel();
      await expect(handle.done).resolves.toEqual({ status: "cancelled" });
    });

    it("settles `done` exactly once, even if the backend reports twice", async () => {
      const { handle, driver } = testCase.start();
      await driver.acceptStart();
      await driver.finishWithResult("first");
      await driver.finishWithResult("second");
      const outcome = await handle.done;
      expect(outcome).toEqual({ status: "completed", result: { response: "first" } });
    });

    it("reports backend failure as a `failed` outcome, not a rejection", async () => {
      const { handle, driver } = testCase.start();
      await driver.acceptStart();
      await driver.finishWithFailure("boom");
      const outcome = await handle.done;
      expect(outcome.status).toBe("failed");
      if (outcome.status === "failed") expect(outcome.error.message).toContain("boom");
    });

    it("drops events delivered after the terminal outcome", async () => {
      const { handle, driver, events } = testCase.start();
      await driver.acceptStart();
      await driver.finishWithResult("done");
      await handle.done;
      const countAtTerminal = events.length;
      await driver.emitToken("too late");
      expect(events.length).toBe(countAtTerminal);
    });
  });
}
