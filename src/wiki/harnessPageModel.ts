/** Answers a documentation brief through the chat model routing (`wiki_page` on the harness). */
import { harness } from "../harness";
import { createRunHost } from "../harness/hostDefaults";
import { resolveExecutionProvider } from "../store/resolveExecutionProvider";
import type { CustomProvider, ProviderStatus } from "../store/types";
import type { PageModel } from "./writer";

export interface ModelChoice {
  customProviders: CustomProvider[];
  providerStatus: Record<string, ProviderStatus>;
  activeCustomProviderId: string | null;
}

/** The model for a repository: its own setting, else the chat's. Fails with a sentence the user can act on. */
export function pageModel(choice: ModelChoice, model: string, workspaceRoot: string): PageModel {
  const resolution = resolveExecutionProvider(choice.customProviders, choice.providerStatus, choice.activeCustomProviderId, model);
  if (!resolution.ok) throw new Error(resolution.message);
  const provider = resolution.provider;
  return (brief, signal) =>
    new Promise<string>((resolve, reject) => {
      const handle = harness.run("wiki_page", { model, customProvider: provider, workspaceRoot, system: brief.system, prompt: brief.prompt }, createRunHost(), () => {});
      const cancel = () => handle.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      void handle.done.then((outcome) => {
        signal.removeEventListener("abort", cancel);
        if (outcome.status === "completed") resolve(outcome.result.markdown);
        else if (outcome.status === "failed") reject(new Error(outcome.error.message));
        else reject(new Error("cancelled"));
      });
    });
}
