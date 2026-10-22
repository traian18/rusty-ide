import type { CustomProvider, ProviderModel } from "../../../store";
import type { ProviderExecutionStatus } from "../../../store/types";

type CheckKind = keyof ProviderExecutionStatus;

/** Discovered models keep what an earlier catalogue or the user set on the same model. */
export function mergeDiscoveredModels(discovered: ProviderModel[], previous: ProviderModel[] = []): ProviderModel[] {
  return discovered.map((model) => {
    const earlier = previous.find((candidate) => candidate.id === model.id)
      || previous.find((candidate) => (candidate.remoteId || candidate.id) === (model.remoteId || model.id));
    return { ...earlier, ...model };
  });
}

export function checkSucceeded(provider: CustomProvider, kind: CheckKind): ProviderExecutionStatus {
  return { ...provider.executionStatus, [kind]: { status: "success", testedAt: new Date().toISOString() } };
}

export function checkFailed(provider: CustomProvider, kind: CheckKind, message: string | undefined): ProviderExecutionStatus {
  return { ...provider.executionStatus, [kind]: { status: "failed", testedAt: new Date().toISOString(), message } };
}

/** The model to switch to when the active one is not in a refreshed catalogue. */
export function replacementActiveModel(selectable: ProviderModel[], activeModel: string): string | undefined {
  if (selectable.length === 0) return undefined;
  return selectable.some((model) => model.id === activeModel) ? undefined : selectable[0].id;
}

export function modelsRefreshedMessage(supported: number, unsupported: number): string {
  const plural = supported === 1 ? "" : "s";
  const disabled = unsupported ? `; ${unsupported} unsupported catalog entries were disabled` : "";
  return `Loaded ${supported} supported model${plural}${disabled}.`;
}
