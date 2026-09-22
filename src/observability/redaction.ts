const SENSITIVE_KEY = /(authorization|cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|credential|private[-_]?key)/i;
const TOKEN_LIKE = /\b(?:sk|ghp|github_pat|xox[baprs]|Bearer)[-_ A-Za-z0-9.]{12,}\b/g;
const MAX_STRING = 16_384;
const MAX_SERIALIZED = 65_536;
const MAX_DEPTH = 8;

export interface SanitizedValue {
  value: unknown;
  state: "full" | "truncated" | "redacted";
}

export function sanitizeForObservability(input: unknown): SanitizedValue {
  let redacted = false;
  let truncated = false;
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number, key?: string): unknown => {
    if (key && SENSITIVE_KEY.test(key)) {
      redacted = true;
      return "[REDACTED]";
    }
    if (typeof value === "string") {
      const scrubbed = value.replace(TOKEN_LIKE, () => {
        redacted = true;
        return "[REDACTED]";
      });
      if (scrubbed.length > MAX_STRING) {
        truncated = true;
        return `${scrubbed.slice(0, MAX_STRING)}\n… [truncated ${scrubbed.length - MAX_STRING} characters]`;
      }
      return scrubbed;
    }
    if (typeof value === "bigint") {
      truncated = true;
      return `${value.toString()}n`;
    }
    if (typeof value === "function" || typeof value === "symbol") {
      truncated = true;
      return `[${typeof value}]`;
    }
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_DEPTH) {
      truncated = true;
      return "[depth limit]";
    }
    if (seen.has(value)) {
      truncated = true;
      return "[circular reference]";
    }
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 100) truncated = true;
      return value.slice(0, 100).map((entry) => visit(entry, depth + 1));
    }
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      result[entryKey] = visit(entryValue, depth + 1, entryKey);
    }
    if (Object.keys(value as object).length > 100) truncated = true;
    return result;
  };

  let value = visit(input, 0);
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    truncated = true;
    value = "[unserializable payload]";
    serialized = JSON.stringify(value);
  }
  if (serialized && serialized.length > MAX_SERIALIZED) {
    truncated = true;
    value = {
      preview: serialized.slice(0, MAX_SERIALIZED),
      notice: `[truncated ${serialized.length - MAX_SERIALIZED} serialized characters]`,
    };
  }
  return { value, state: redacted ? "redacted" : truncated ? "truncated" : "full" };
}
