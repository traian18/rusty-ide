/**
 * Updates documentation pages in the background: one job in the bubble, pages written one at a
 * time through the chat model routing, each page removed from the saved queue once written so a
 * restart carries on with the rest. The bubble's × stops it.
 */
import { pageModel } from "../wiki/harnessPageModel";
import { docsClient, type DocsClient } from "../wiki/client";
import { writePage, type PageModel } from "../wiki/writer";
import { writingOrder } from "../wiki/written";
import { useWorkspaceStore } from "../store";
import { backgroundClient, type BackgroundClient } from "./client";
import { useBackground } from "./backgroundStore";

const running = new Set<string>();

export interface RunnerDeps {
  background: BackgroundClient;
  docs: DocsClient;
  /** Builds the function that answers a brief with `model`. */
  model(model: string, root: string): PageModel;
}

const defaults: RunnerDeps = {
  background: backgroundClient,
  docs: docsClient,
  model: (model, root) => {
    const store = useWorkspaceStore.getState();
    return pageModel({ customProviders: store.customProviders, providerStatus: store.providerStatus, activeCustomProviderId: store.activeCustomProviderId }, model, root);
  },
};

function name(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

/** Writes the queued pages of `root`; resolves when done, failed or stopped. */
export async function runDocumentationUpdate(root: string, deps: RunnerDeps = defaults): Promise<void> {
  if (running.has(root)) return;
  running.add(root);
  let job: number | null = null;
  try {
    const pending = await deps.background.pending(root);
    if (!pending.pages.length) return;
    const settings = await deps.docs.documentationSettings(root).catch(() => ({ model: null, style: null }));
    const model = pending.model ?? settings.model ?? useWorkspaceStore.getState().activeModel ?? "";
    const plan = await deps.docs.documentationPlan(root);
    const kinds = new Map(plan.pages.map((p) => [p.id, p.kind]));
    const order = writingOrder(pending.pages.map((id) => ({ id, kind: kinds.get(id) ?? "module" })));
    job = await deps.background.start(root, `Updating documentation of ${name(root)}`);
    const id = job;
    const controller = new AbortController();
    const unsubscribe = useBackground.subscribe((state) => {
      if (state.jobs.some((j) => j.id === id && j.state === "cancelled")) controller.abort();
    });
    let ask: PageModel;
    try {
      ask = deps.model(model, root);
    } catch (error) {
      unsubscribe();
      await deps.background.finish(id, true, error instanceof Error ? error.message : String(error));
      return;
    }
    let failures = 0;
    for (const [index, page] of order.entries()) {
      if (controller.signal.aborted) break;
      const title = plan.pages.find((p) => p.id === page)?.title ?? page;
      await deps.background.progress(id, index, order.length, `Writing ${title}`);
      try {
        await writePage(deps.docs, root, page, model, ask, controller.signal);
        await deps.background.done(root, page);
      } catch {
        if (controller.signal.aborted) break;
        failures += 1;
      }
    }
    unsubscribe();
    if (!controller.signal.aborted) {
      await deps.background.finish(id, failures > 0, failures ? `${failures} of ${order.length} pages could not be written; they stay queued.` : null);
    }
  } catch (error) {
    if (job !== null) await deps.background.finish(job, true, error instanceof Error ? error.message : String(error)).catch(() => undefined);
  } finally {
    running.delete(root);
  }
}

/** After a commit: if pages were built from what it changed, ask whether to update them. */
export async function offerDocumentationUpdate(root: string, deps: RunnerDeps = defaults): Promise<void> {
  const changed = await deps.background.afterCommit(root);
  if (!changed.pages.length) return;
  const files = changed.files.length;
  useBackground.getState().ask({
    id: `docs:${root}:${changed.commit}`,
    title: "Update the documentation?",
    message: `Your commit changed ${files} file${files === 1 ? "" : "s"} that ${changed.pages.length} documentation page${changed.pages.length === 1 ? " was" : "s were"} written from (${changed.pages.slice(0, 3).map((p) => p.title).join(", ")}${changed.pages.length > 3 ? ", …" : ""}). It runs in the background.`,
    accept: "Update",
    onAccept: () => {
      void deps.background.queue(root, changed.pages.map((p) => p.id), null).then(() => runDocumentationUpdate(root, deps));
    },
  });
}
