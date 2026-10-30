type StopExecutionCallback = (nodeId: string) => void;

let stopCallback: StopExecutionCallback | null = null;

export function setStopExecutionCallback(cb: StopExecutionCallback | null): void {
  stopCallback = cb;
}

export function requestStopExecution(nodeId: string): void {
  if (stopCallback) {
    stopCallback(nodeId);
  } else {
    console.warn(`[stopExecution] No callback registered. Node ${nodeId} stop requested but not handled.`);
  }
}