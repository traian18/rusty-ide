/**
 * starterFlow.ts — the Plan → Build → Verify workflow a workspace starts with.
 *
 * A new user opening the Behaviors tab or Agent Mode should find a complete,
 * working flow instead of an empty canvas. The documents are ordinary
 * `.rusty/workflows` and `.rusty/profiles` files, fully filled in, so they can
 * be read, run, and edited like any the user creates. They are the same JSON
 * the Rust tests in `src-tauri/src/harness/workflow.rs` compile and run.
 *
 * Seeding is add-only: it never overwrites a file, skips a workspace that
 * already has workflows of its own, and happens once per workspace so a flow
 * the user deletes does not come back.
 */

import { invoke } from "@tauri-apps/api/core";
import type { JsonObject } from "./behaviorModel";
import { behaviorService, profilePath, workflowPath } from "./behaviorService";
import buildProfile from "./starter/build.profile.json";
import planProfile from "./starter/plan.profile.json";
import starterWorkflow from "./starter/plan-build-verify.workflow.json";

export const STARTER_WORKFLOW_ID = "plan-build-verify";
// Through `unknown`: TypeScript infers a union of optional-undefined shapes
// from the JSON's mixed arrays, which is not the strict `Json` type. These are
// plain JSON files, parsed and compiled by the Rust tests.
export const STARTER_WORKFLOW = starterWorkflow as unknown as JsonObject;
/** Plan first: the workflow's steps reference both by id. */
export const STARTER_PROFILES = [planProfile, buildProfile] as unknown as JsonObject[];

export const STARTER_SEEDED_STORAGE_KEY = "rusty_starter_flow_seeded";

/** Whether `path` is the starter workflow file, on either path separator. */
export function isStarterWorkflowPath(path: string): boolean {
  return path.replace(/\\/g, "/").endsWith(`/.rusty/workflows/${STARTER_WORKFLOW_ID}.json`);
}

function readSeeded(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STARTER_SEEDED_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function markSeeded(rootPath: string): void {
  try {
    const seeded = readSeeded();
    if (!seeded.includes(rootPath)) localStorage.setItem(STARTER_SEEDED_STORAGE_KEY, JSON.stringify([...seeded, rootPath]));
  } catch {
    // Best effort: without storage the flow is only added again while the workspace has no workflows.
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await invoke<string>("read_file_disk", { path });
    return true;
  } catch {
    return false;
  }
}

async function seed(rootPath: string): Promise<boolean> {
  if (readSeeded().includes(rootPath)) return false;
  try {
    const profileTargets = STARTER_PROFILES.map((profile) => profilePath(rootPath, String(profile.id)));
    const workflowTarget = workflowPath(rootPath, STARTER_WORKFLOW_ID);
    const { documents } = await behaviorService.loadWorkflows(rootPath);
    const taken = documents.length > 0 || (await Promise.all([...profileTargets, workflowTarget].map(exists))).some(Boolean);
    if (!taken) {
      // Profiles first, so the workflow never exists without what its steps name.
      for (const [index, profile] of STARTER_PROFILES.entries()) await behaviorService.save(profileTargets[index], profile);
      await behaviorService.save(workflowTarget, STARTER_WORKFLOW);
    }
    markSeeded(rootPath);
    return !taken;
  } catch (error) {
    console.warn("Could not add the starter workflow:", error);
    return false;
  }
}

const inFlight = new Map<string, Promise<boolean>>();

/**
 * Adds the starter flow to `rootPath` if it has no workflows yet. Resolves to
 * whether files were written; never rejects. Callers await it before loading
 * workflows, and concurrent calls for one workspace share a single run.
 */
export function ensureStarterFlow(rootPath: string): Promise<boolean> {
  let pending = inFlight.get(rootPath);
  if (!pending) {
    pending = seed(rootPath).finally(() => inFlight.delete(rootPath));
    inFlight.set(rootPath, pending);
  }
  return pending;
}
