import { tauriPersistence } from "../../observability/persistence";

export type ExecutionDiagnosticLevel = "info" | "warn" | "error";

export interface ExecutionDiagnosticRecord {
  id: string;
  timestamp: string;
  level: ExecutionDiagnosticLevel;
  category: string;
  message: string;
  details?: unknown;
}

function makeId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `diag-${random}`;
}

function truncateString(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]` : value;
}

function sanitizeForLog(value: unknown, maxChars = 4_000): unknown {
  if (typeof value === "string") return truncateString(value, maxChars);
  if (value === null || typeof value !== "object") return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) return value;
    return truncateString(json, maxChars);
  } catch {
    return String(value);
  }
}

export function writeExecutionDiagnostic(
  workspaceRoot: string | undefined,
  level: ExecutionDiagnosticLevel,
  category: string,
  message: string,
  details?: unknown,
): void {
  const record: ExecutionDiagnosticRecord = {
    id: makeId(),
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    details: sanitizeForLog(details),
  };

  if (typeof globalThis !== "object" || !("__TAURI_INTERNALS__" in globalThis)) {
    return;
  }

  void tauriPersistence.append(workspaceRoot, "diagnostics", [record]).catch((error) => {
    console.warn("[ExecutionDiagnostics] failed to persist diagnostic", { error, record });
  });
}

export function logExecutionDiagnostic(
  workspaceRoot: string | undefined,
  level: ExecutionDiagnosticLevel,
  category: string,
  message: string,
  details?: unknown,
): void {
  const prefix = `[${category}] ${message}`;
  if (level === "error") console.error(prefix, details ?? {});
  else if (level === "warn") console.warn(prefix, details ?? {});
  else console.info(prefix, details ?? {});
  writeExecutionDiagnostic(workspaceRoot, level, category, message, details);
}
