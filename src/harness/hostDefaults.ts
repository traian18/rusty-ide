// ============================================================
// hostDefaults.ts — Builds a RunHost for a component or coordinator to
// pass to harness.run(), filling in requestPermission from the shared
// commandPermissionService (so every caller gets the same permission
// dialog for free) and defaulting readFile/writeFile/writePlan/
// askQuestion to a clear rejection for a capability that has no business
// needing them (e.g. inline_chat, which the sidecar never sends file or
// question RPC for) rather than silently hanging.
// ============================================================

import { commandPermissionService } from "../services/commandPermissionService";
import type { RunHost } from "./contract";

export interface RunHostOptions {
  readFile?: RunHost["readFile"];
  writeFile?: RunHost["writeFile"];
  writePlan?: RunHost["writePlan"];
  askQuestion?: RunHost["askQuestion"];
}

function unsupported(kind: string): () => Promise<never> {
  return () => Promise.reject(new Error(`This run has no ${kind} handler.`));
}

export function createRunHost(options: RunHostOptions = {}): RunHost {
  return {
    readFile: options.readFile ?? unsupported("readFile"),
    writeFile: options.writeFile ?? unsupported("writeFile"),
    writePlan: options.writePlan,
    askQuestion: options.askQuestion,
    requestPermission: (request, signal) => commandPermissionService.request(request, signal),
  };
}
