// ============================================================
// recordingHost.ts — A RunHost that records every call it receives, in
// order, and rejects a pending call once its AbortSignal fires.
//
// Shared by FakeHarness.test.ts and (Milestone A4) SidecarHarness.test.ts so
// the contract suite in contractTests.ts can assert the same host-call
// behavior against different backends without each test file re-inventing
// this bookkeeping.
// ============================================================

import type { RunHost } from "../contract";

export interface RecordingHost {
  host: RunHost;
  /** Every call this host received, in the order it received them, e.g.
   * "read:/a", "write:/b", "permission", "permission:aborted". */
  calls: string[];
}

export function createRecordingHost(): RecordingHost {
  const calls: string[] = [];
  const host: RunHost = {
    readFile: async (path, signal) => {
      calls.push(`read:${path}`);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return "";
    },
    writeFile: async (path, _content, signal) => {
      calls.push(`write:${path}`);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    },
    requestPermission: (_request, signal) =>
      new Promise((_resolve, reject) => {
        calls.push("permission");
        signal.addEventListener("abort", () => {
          calls.push("permission:aborted");
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  };
  return { host, calls };
}
