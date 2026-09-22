// ============================================================
// DirectExecutionAnswerer.ts — Phase 2's ExecutionAnswerer (Host-routed
// execution backend plan): answers one model turn by calling pi-ai's
// per-provider request modules directly (directExecution.ts), never
// touching the Node sidecar. Mirrors SidecarExecutionAnswerer.ts's own
// shape exactly -- same interface, same abort wiring -- but has no
// WS/Tauri round trip at all: `onEvent` is called straight from
// `runDirectExecution`'s own stream loop, and `signal` is the run's own
// AbortSignal, forwarded straight into pi-ai's `streamSimple` (and from
// there into the underlying SDK's own `fetch`).
// ============================================================

import type { CustomProvider } from "../../../store/types";
import type { ExecutionAnswerer } from "../CoreHarness";
import { runDirectExecution, toDirectExecutionError } from "./directExecution";
import type { ExecutionError, ExecutionEvent, ExecutionRequest, ExecutionResult } from "./ExecutionProtocol";

export class DirectExecutionAnswerer implements ExecutionAnswerer {
  execute(
    request: ExecutionRequest,
    customProvider: unknown,
    onEvent: (event: ExecutionEvent) => void,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    return runDirectExecution(request, customProvider as CustomProvider, onEvent, signal).catch((error: unknown) => {
      throw toDirectExecutionError(error) satisfies ExecutionError;
    });
  }
}
