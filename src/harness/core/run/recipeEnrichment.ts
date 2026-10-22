import type { CapabilityInput, CapabilityName, RunHost } from "../../contract";
import type { CoreCapabilityDefinition } from "../CoreHarness";
import type { SessionRecipe } from "../SessionRecipe";
import { ignoreFailure } from "./failures";

/** How long a run waits for `enrichRecipe` before going ahead without it. */
export const RECIPE_ENRICHMENT_DEADLINE_MS = 2500;

/** `definition.enrichRecipe`'s answer if it arrives in time and is usable, else `recipe` unchanged. */
export async function enrichedRecipe<K extends CapabilityName>(
  definition: CoreCapabilityDefinition<K>,
  recipe: SessionRecipe,
  input: CapabilityInput<K>,
  host: RunHost,
  signal: AbortSignal,
  deadlineMs: number = RECIPE_ENRICHMENT_DEADLINE_MS,
): Promise<SessionRecipe> {
  if (!definition.enrichRecipe || signal.aborted) return recipe;
  // Its own signal, so that giving up on a slow enrichment also stops the work it started.
  const own = new AbortController();
  let giveUp: (value: undefined) => void = () => {};
  const gaveUp = new Promise<undefined>((resolve) => {
    giveUp = resolve;
  });
  const stop = () => {
    own.abort();
    giveUp(undefined);
  };
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, deadlineMs);
  try {
    const answer = definition.enrichRecipe(recipe, input, host, own.signal);
    // If giving up wins, the late answer (or its failure) must not surface as an unhandled rejection.
    answer.catch(ignoreFailure("enriching the session recipe"));
    return (await Promise.race([answer, gaveUp])) ?? recipe;
  } catch {
    return recipe;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}
