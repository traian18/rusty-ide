import type { HostToolHandler } from './CoreHarness';

type Outcome = Awaited<ReturnType<HostToolHandler>>;
export interface CheckEvidence { id: string; key: string; fingerprint: string; result: Outcome; createdAt: number }

/** Evidence is owned by one capability run and never loaded from model text.
 * Only successful, stable checks are reusable. Unknown fingerprints fail closed.
 */
export class CheckEvidenceLedger {
  private entries = new Map<string, CheckEvidence>();
  private unavailable = false;
  constructor(private snapshot: () => Promise<string>) {}
  async fingerprint(): Promise<string | undefined> { if (this.unavailable) return undefined; try { return await this.snapshot(); } catch { this.unavailable = true; return undefined; } }
  find(key: string, fingerprint: string | undefined): CheckEvidence | undefined {
    const entry = this.entries.get(key);
    return fingerprint && entry?.fingerprint === fingerprint && Date.now() - entry.createdAt < 5 * 60_000 ? entry : undefined;
  }
  record(key: string, before: string | undefined, after: string | undefined, result: Outcome): CheckEvidence | undefined {
    this.entries.delete(key);
    if (!result.ok || !before || before !== after) return undefined;
    const entry = { id: crypto.randomUUID(), key, fingerprint: before, result, createdAt: Date.now() };
    this.entries.set(key, entry);
    return entry;
  }
  forget(key: string) { this.entries.delete(key); }
  invalidate() { this.entries.clear(); }
}
