import { activeSpecChange } from "./activeChange";
import { formatActiveBrief } from "./chatBrief";
import { specsClient, type SpecsClient } from "./client";

/** The brief about the active change of a repository for the agent's instructions; empty when there is none, it is gone, or it cannot be read. Never throws. */
export async function activeSpecBrief(root: string, client: SpecsClient = specsClient, active: string | null = activeSpecChange(root)): Promise<string> {
  if (!active) return "";
  try {
    const overview = await client.overview(root);
    const change = overview.changes.find((candidate) => candidate.dir === active);
    if (!change || change.status === "archived") return "";
    return formatActiveBrief(overview.root, change, await client.tasks(root, change.dir));
  } catch {
    return "";
  }
}
