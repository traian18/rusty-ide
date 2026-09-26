import { useEffect, useSyncExternalStore } from "react";
import { useWorkspaceStore } from "../store";
import { executionObservability } from "./executionStore";
import { trajectories } from "./trajectoryStore";

let flushOnHideInstalled = false;

export function useExecutionObservability() {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  useEffect(() => {
    void executionObservability.setWorkspace(rootPath || undefined);
    if (!flushOnHideInstalled && typeof window !== "undefined") {
      flushOnHideInstalled = true;
      window.addEventListener("pagehide", () => {
        void executionObservability.flush();
        void trajectories.flush();
      });
    }
  }, [rootPath]);
  return useSyncExternalStore(executionObservability.subscribe, executionObservability.getSnapshot, executionObservability.getSnapshot);
}
