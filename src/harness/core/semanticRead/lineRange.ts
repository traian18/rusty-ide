/** Most lines one exact-range read returns; a longer range is cut here and the
 * result says where to continue. */
export const MAX_RANGE_READ_LINES = 2_000;

export interface LineRangeRequest {
  startLine?: number;
  endLine?: number;
}

/** Reads `start_line`/`end_line` from read_file arguments; `undefined` when
 * neither is given. Throws on values that are not positive integers. */
export function parseLineRange(args: unknown): LineRangeRequest | undefined {
  const record = (args ?? {}) as { start_line?: unknown; end_line?: unknown };
  if (record.start_line === undefined && record.end_line === undefined) return undefined;
  const read = (value: unknown, name: string): number | undefined => {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`read_file ${name} must be a positive integer.`);
    return value as number;
  };
  const range = { startLine: read(record.start_line, "start_line"), endLine: read(record.end_line, "end_line") };
  if (range.startLine !== undefined && range.endLine !== undefined && range.endLine < range.startLine) {
    throw new Error("read_file end_line must be greater than or equal to start_line.");
  }
  return range;
}

/** The requested lines of `content` with a header, capped at
 * `MAX_RANGE_READ_LINES` and ending with where to continue when more remains. */
export function readLineRange(path: string, content: string, range: LineRangeRequest): string {
  const lines = content.split(/\r?\n/);
  const total = lines.length;
  const start = range.startLine ?? 1;
  if (start > total) return `File: ${path}\n[start_line ${start} is past the end of the file, which has ${total} lines.]`;
  const wanted = Math.min(range.endLine ?? total, total);
  const end = Math.min(wanted, start + MAX_RANGE_READ_LINES - 1);
  const parts = [`File: ${path} (${total} lines)`, `[lines ${start}-${end}]`, lines.slice(start - 1, end).join("\n")];
  if (end < wanted) {
    parts.push("", `[Range limit of ${MAX_RANGE_READ_LINES} lines reached. Continue with start_line ${end + 1}.]`);
  }
  return parts.join("\n");
}
