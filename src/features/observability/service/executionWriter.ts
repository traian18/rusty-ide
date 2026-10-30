import { takeLegacyItem, type ObservabilityPersistence } from "./persistence";
import { healIfActive } from "./toolCallRecords";
import type { ToolExecutionRecord } from "./types";

export type Root = string | undefined;
export const rootOf = (record: ToolExecutionRecord): Root => record.context?.workspaceRoot || undefined;

const WRITE_DELAY_MS = 1000;

function groupByRoot(records: ToolExecutionRecord[]): Map<Root, ToolExecutionRecord[]> {
  const byRoot = new Map<Root, ToolExecutionRecord[]>();
  for (const record of records) byRoot.set(rootOf(record), [...(byRoot.get(rootOf(record)) ?? []), record]);
  return byRoot;
}

/** The records in a legacy localStorage value, or undefined when it is not JSON. */
function parseLegacyRecords(raw: string): ToolExecutionRecord[] | undefined {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((record) => typeof record?.id === "string") : [];
  } catch {
    return undefined;
  }
}

/** Writes changed execution records to each workspace's history on disk,
 * batched: `queue` marks a record, `schedule` writes the batch a second
 * later. A batch that fails to write stays queued for the next write. */
export class ExecutionRecordWriter {
  private pending = new Map<string, ToolExecutionRecord>();
  private timer?: ReturnType<typeof setTimeout>;
  private migrated = false;

  constructor(
    private persistence: ObservabilityPersistence,
    /** Runs a scheduled write; the store's own flush, which reports errors. */
    private flushDue: () => Promise<void>,
  ) {}

  has(id: string): boolean {
    return this.pending.has(id);
  }

  queue(record: ToolExecutionRecord): void {
    this.pending.set(record.id, record);
  }

  forget(id: string): void {
    this.pending.delete(id);
  }

  forgetWhere(matches: (record: ToolExecutionRecord) => boolean): void {
    for (const [id, record] of this.pending) if (matches(record)) this.pending.delete(id);
  }

  forgetAll(): void {
    this.pending.clear();
  }

  schedule(): void {
    if (!this.timer) this.timer = setTimeout(() => void this.flushDue(), WRITE_DELAY_MS);
  }

  scheduleIfPending(): void {
    if (this.pending.size) this.schedule();
  }

  /** Writes every queued record now. False when nothing was queued; on a
   * failure the batch is queued again and the error rethrown. */
  async write(): Promise<boolean> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.size === 0) return false;
    const batch = [...this.pending.values()];
    this.pending.clear();
    try {
      await this.append(batch);
    } catch (error) {
      for (const record of batch) if (!this.pending.has(record.id)) this.pending.set(record.id, record);
      throw error;
    }
    return true;
  }

  /** Moves history kept under `key` in localStorage (before disk history
   * existed) to disk, once per writer. Unreadable history is dropped; on a
   * write failure it stays for the next start and the error is rethrown. */
  async migrateLegacy(key: string): Promise<void> {
    if (this.migrated) return;
    this.migrated = true;
    const legacy = takeLegacyItem(key);
    if (!legacy) return;
    const records = parseLegacyRecords(legacy.raw);
    if (records) await this.append(records.map(healIfActive));
    legacy.remove();
  }

  private async append(records: ToolExecutionRecord[]): Promise<void> {
    for (const [root, rows] of groupByRoot(records)) await this.persistence.append(root, "executions", rows);
  }
}
