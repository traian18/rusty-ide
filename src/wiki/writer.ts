/** Writes documentation pages: the host builds the brief, the chat model routing answers it, the host checks the answer. */
import type { DocsClient } from "./client";
import { writingOrder, type PlannedPage, type WrittenView } from "./written";

/** Sends one brief to a model and returns its Markdown. */
export type PageModel = (brief: { system: string; prompt: string }, signal: AbortSignal) => Promise<string>;

export interface WriteProgress {
  done: number;
  total: number;
  current: string | null;
  failures: { id: string; message: string }[];
}

export async function writePage(client: DocsClient, root: string, id: string, model: string, ask: PageModel, signal: AbortSignal): Promise<WrittenView> {
  const brief = await client.documentationBrief(root, id);
  // The glossary is mined from the repository's own documents: no model writes it.
  if (brief.prewritten !== null && brief.prewritten !== undefined) return client.documentationSave(root, id, brief.prewritten, "repository documents");
  const markdown = await ask({ system: brief.system, prompt: brief.prompt }, signal);
  return client.documentationSave(root, id, markdown, model);
}

/** Writes pages one at a time so each can use the ones below it; a failed page does not stop the rest. */
export async function writePages(client: DocsClient, root: string, pages: readonly PlannedPage[], model: string, ask: PageModel, signal: AbortSignal, onProgress: (progress: WriteProgress) => void): Promise<WriteProgress> {
  const order = writingOrder(pages);
  const progress: WriteProgress = { done: 0, total: order.length, current: null, failures: [] };
  for (const id of order) {
    if (signal.aborted) break;
    progress.current = id;
    onProgress({ ...progress, failures: [...progress.failures] });
    try {
      await writePage(client, root, id, model, ask, signal);
    } catch (error) {
      if (signal.aborted) break;
      progress.failures.push({ id, message: error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error) });
    }
    progress.done += 1;
  }
  progress.current = null;
  onProgress({ ...progress, failures: [...progress.failures] });
  return progress;
}
