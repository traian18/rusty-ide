/**
 * flowCatalog.ts -- what a workflow document says about how flows are chosen
 * and handed over, read from its free-form `metadata` (the engine ignores it):
 *
 * - `metadata.route.when`: when this workflow is the right one for a message,
 *   in the words the flow router shows its decision model.
 * - `metadata.switch_to`: ids of the workflows a running one may hand over to.
 *
 * Whether a workflow *edits* is not declared: it is read from the profiles its
 * steps run under, so it holds for workflows you write yourself too.
 */

import { isObject, type Json, type JsonObject } from "./behaviorModel";

const BUILTIN_ID_PREFIX = "rusty-ide.builtin.";

/** What a chat's workflow is set to when Rusty chooses the workflow for each message. */
export const AUTO_FLOW = "auto";

export interface FlowRoute {
  /** When this workflow is the right choice, as the router is asked it. */
  when: string;
}

export function workflowRoute(document: JsonObject | undefined): FlowRoute | undefined {
  const metadata = document?.metadata;
  const route = isObject(metadata) ? metadata.route : undefined;
  const when = isObject(route) && typeof route.when === "string" ? route.when.trim() : "";
  return when ? { when } : undefined;
}

/** Ids a running workflow may hand over to, in the order they were declared. */
export function workflowSwitchTargets(document: JsonObject | undefined): string[] {
  const metadata = document?.metadata;
  const targets = isObject(metadata) ? metadata.switch_to : undefined;
  if (!Array.isArray(targets)) return [];
  return [...new Set(targets.filter((target): target is string => typeof target === "string" && target.trim() !== "").map((target) => target.trim()))];
}

/** A workflow's id with the built-in namespace removed. */
export function shortWorkflowId(id: string): string {
  return id.startsWith(BUILTIN_ID_PREFIX) ? id.slice(BUILTIN_ID_PREFIX.length) : id;
}

/** Whether a rule's `when.tool` filter covers `tool`; no filter covers every tool. */
function coversTool(when: Json | undefined, tool: string): boolean {
  const filter = isObject(when) ? when.tool : undefined;
  if (filter === undefined) return true;
  const names = Array.isArray(filter) ? filter : [filter];
  return names.some((name) => name === "*" || name === tool);
}

/** Whether a step under `profile` can change files: not when its allow-list
 * leaves out both `write_file` and `edit_file`, nor when a rule denies
 * `write_file` before it runs (rusty-core applies a rule for `write_file` to
 * `edit_file` too). */
export function profileMayEdit(profile: JsonObject | undefined): boolean {
  if (!profile) return true;
  const tools = profile.tools;
  if (isObject(tools) && tools.type === "allow_list" && Array.isArray(tools.tools) && !tools.tools.some((tool) => tool === "write_file" || tool === "edit_file")) return false;
  const rules = Array.isArray(profile.rules) ? profile.rules : [];
  const denies = rules.some((rule) =>
    isObject(rule) && rule.on === "PreToolUse" && isObject(rule.do) && "deny" in rule.do && coversTool(rule.when, "write_file"),
  );
  return !denies;
}

function findProfile(profiles: JsonObject[], id: string): JsonObject | undefined {
  return profiles.find((profile) => profile.id === id) ?? profiles.find((profile) => profile.id === `${BUILTIN_ID_PREFIX}${id}`);
}

/** Whether any agent step of `document` can change files. A step with no
 * profile, or one that cannot be found, runs under whatever the session has,
 * so it counts as able to. */
export function workflowMayEdit(document: JsonObject, profiles: JsonObject[]): boolean {
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  return nodes.some((node) => {
    if (!isObject(node) || node.type !== "agent") return false;
    const config = isObject(node.config) ? node.config : {};
    const id = isObject(config.profile) && typeof config.profile.id === "string" ? config.profile.id : undefined;
    return profileMayEdit(id ? findProfile(profiles, id) : undefined);
  });
}
