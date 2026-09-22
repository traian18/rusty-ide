import { useSyncExternalStore } from "react";
import { executionObservability } from "./executionStore";

export function useExecutionObservability() {
  return useSyncExternalStore(executionObservability.subscribe, executionObservability.getSnapshot, executionObservability.getSnapshot);
}
