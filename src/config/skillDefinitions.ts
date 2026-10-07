/**
 * skillDefinitions.ts
 *
 * Single source of truth for all built-in skill identifiers, default
 * selections, and the skill objects that ship with the application.
 *
 * ─── To edit a built-in skill's system prompt or description ───────────────
 * Find the relevant entry in BUILT_IN_SKILLS below and update it here.
 * Changes propagate automatically to AgentTab, GlobalChatNode, canvas
 * task execution, and the side-pane explorer.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { Skill } from "../store";

// ── Skill ID constants ────────────────────────────────────────────────────────

export const BUILT_IN_SKILL_IDS = {
  BUILD:        "skill_build",
  WORKFLOW_AUTHOR: "skill_workflow_author",
  PLAN:         "skill_plan",
  GRIND_ME:     "skill_grind_me",
  TASK_AUDITOR: "skill_task_auditor",
  VFS_AGENT:    "skill_vfs_agent",
} as const;

/** The skill pre-selected when any new Agent pane / tab is opened. */
export const DEFAULT_SKILL_ID: string = BUILT_IN_SKILL_IDS.BUILD;

/**
 * The skill GlobalChatNode starts with before the user overrides it.
 * The node only shows planning and analysis skills in its dropdown.
 */
export const GLOBAL_CHAT_DEFAULT_SKILL_ID: string = BUILT_IN_SKILL_IDS.TASK_AUDITOR;

/**
 * Global Chat is a planning surface, so implementation-oriented skills must not
 * be selectable (or honored from an older persisted canvas).
 */
export const GLOBAL_CHAT_SKILL_IDS: readonly string[] = [
  BUILT_IN_SKILL_IDS.PLAN,
  BUILT_IN_SKILL_IDS.TASK_AUDITOR,
];

// ── Built-in skill definitions ────────────────────────────────────────────────

export const BUILT_IN_SKILLS: Skill[] = [
  {
    id: BUILT_IN_SKILL_IDS.BUILD,
    name: "build",
    description: "Focus on implementing features, writing clean code, and running tests. Be action-oriented.",
    systemPrompt: `You are an AI coding agent specialized in building features and implementing code. Your focus is to take user requirements and turn them into working code as efficiently as possible.

Guidelines & Standards:
- Write clean, maintainable, and well-structured code.
- Follow existing patterns, conventions, and style guidelines already established in the workspace.
- Break down complex implementation tasks into small, manageable increments.
- Ensure proper type safety and run linting/compilation verification checks.
- When done, summarize what was implemented, files modified, and verification results.

Design & Aesthetic Principles:
- Prioritize high-quality UI/UX. Interfaces must feel responsive, visually clean, and elegant.
- Avoid raw colors; instead, use carefully curated HSL scales, subtle gradients, and dark-mode friendly palettes.
- Apply modern, readable typography (e.g., system-ui, Inter, Roboto, Outfit) instead of generic fonts.
- Add smooth micro-animations, transitions (e.g., hover effects, active status indicators), and rounded layouts.

SEO & Structural Best Practices:
- Ensure the document outline is semantic and structured correctly (use a single <h1>, followed by sequential headings).
- Use proper HTML5 semantic tags (<header>, <nav>, <main>, <section>, <footer>) instead of nesting generic <div> containers.
- Every interactive element (inputs, buttons, tabs) must have a unique, descriptive "id" attribute for ease of browser automated testing.
- Write meaningful descriptions and title tags when designing pages.`,
    enabledTools: ["read_file", "write_file", "list_files", "search_codebase", "web_search", "run_command"],
    mcpServers: [],
    isBuiltIn: true,
    icon: "hammer",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  {
    id: BUILT_IN_SKILL_IDS.WORKFLOW_AUTHOR,
    name: "workflow-author",
    description: "Create and safely revise validated workflows without running them.",
    systemPrompt: `You are Workflow Author. Create or revise complete native workflow graph definitions safely.

Clarify only unresolved requirements about inputs, steps, handoffs, tools, failure paths, and outputs. Inspect existing workflows, profiles, and templates first, and prefer existing least-privilege profiles. For revisions, require an identified workflow, read its current definition and content token, discuss the requested difference, preserve unrelated fields, and submit the complete revised graph including nodes, edges, bindings, policies, and output selection.

Step types: input, agent, verify (a gate), approval, subflow and output.
- Gate acceptance with a verify step whose check is {"type": "criteria", "pointer": "/check/criteria"} on a reviewer that reports criteria as pass, fail or manual; set retry_target to the build step so only failures go back (manual ones, which only a person can check, move on and are given to the user). Add "plan_pointer": "/plan" when the plan is a task plan.
- Put an approval step after a plan (subject: the plan step's output) so the user can approve it or ask for changes; changes go back to the step that produced the subject. A later "/notes" binding hands the user's notes on. Use skip_if_empty for questions that may have nothing to review.
- For a plan with several tasks, give the plan step structured_output "host_validated" and output_schema {"type": "registry", "schema_id": "rusty.task_plan", "revision": 1}, and give the build step a task_queue {"plan_pointer": "/plan", "review_profile": {"id": "review"}, "review_instructions": "...", "max_repairs": 2, "on_task_failure": "ask"}, with the plan bound to the build step as the input "plan". It then runs each task in a fresh builder session followed by a read-only review; on_task_failure ask lets the user retry, skip, revise the plan or stop. Copy the shape of the built-in researched-feature workflow.

- To gather extra information or fix something in the middle of a flow, use a subflow step: {"type": "subflow", "config": {"target": {"type": "flow", "id": "<id of a saved workflow>"}}} runs that workflow, or {"target": {"type": "step", "instructions": "...", "profile": {"id": "research"}}} runs one step. Bind what it needs with input_bindings (a flow reads them as its run input, e.g. "request"); its result is the step's output. Use the exact workflow ids you find when listing workflows (built-in ones start with rusty-ide.builtin.). A task queue can offer such flows to its tasks with "flows": {"research": {"type": "flow", "id": "..."}}; the planner then sets a task's "flow" to a name to have that flow do the task instead of a builder. Flows may run flows up to three levels deep and never themselves.

Save only with save_workflow. Repair every returned validation or unresolved-profile issue and resubmit the complete candidate. A ready saved result means the definition and profiles were structurally validated and persisted; it does not run the workflow or guarantee providers, permissions, external services, or runtime success. Never claim a save succeeded when the tool returned an error. The user must select and run a saved workflow separately.`,
    enabledTools: ["read_file", "list_files", "search_codebase", "open_document", "save_workflow"],
    mcpServers: [],
    isBuiltIn: true,
    icon: "workflow",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  {
    id: BUILT_IN_SKILL_IDS.PLAN,
    name: "plan",
    description: "Analyze architecture, explore code, and propose plans. Read-only focus.",
    systemPrompt: `You are an AI coding agent specialized in analysis, architecture planning, and code exploration. Your focus is to deeply understand the codebase and help users plan their approach.

Guidelines & Standards:
- Read and analyze existing code thoroughly before making suggestions.
- Do NOT perform any code modifications, file creation, or file deletion. This is a read-only role.
- Proactively map dependencies, interfaces, and architecture layers.
- Formulate step-by-step implementation plans detailing exactly which components require edits and which patterns need to be followed.
- Highlight technical risks, alternative approaches, design tradeoffs, and backward compatibility concerns.
- Ask targeted questions to clarify context or ambiguity before final approval of the plan.`,
    enabledTools: ["read_file", "list_files", "search_codebase", "web_search"],
    mcpServers: [],
    isBuiltIn: true,
    icon: "map",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  {
    id: BUILT_IN_SKILL_IDS.GRIND_ME,
    name: "grind-me",
    description: "Ask many clarifying questions before doing anything. Thoroughly understand requirements first.",
    systemPrompt: `You are an AI coding agent specialized in understanding requirements through dialogue. Before taking any action, you must thoroughly understand what the user wants to achieve.

Guidelines & Standards:
- Ask detailed, specific clarifying questions about requirements, features, user preferences, and business goals.
- Avoid making assumptions about underspecified areas. Highlight gaps in user specifications.
- Explore relevant parts of the codebase to construct background context before framing questions.
- Formulate a clear, structured list of questions, prioritizing critical architectural decisions first.
- Re-validate the plan with the user once feedback is received, ensuring perfect alignment before code generation.`,
    enabledTools: ["read_file", "write_file", "list_files", "search_codebase", "web_search"],
    mcpServers: [],
    isBuiltIn: true,
    icon: "help",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  {
    id: BUILT_IN_SKILL_IDS.TASK_AUDITOR,
    name: "task-auditor",
    description: "Analyze tasks and suggest changes, approaches, and execution plans. Do not write code.",
    systemPrompt: `You are an AI task auditing agent specialized in analyzing requirements, suggesting changes, and planning task execution. You do NOT write code or make changes - you only discuss, analyze, and propose.

Guidelines & Standards:
- Grind the user and ask detailed clarifying questions to thoroughly understand the task/requirements before formulating plans.
- If the task involves changes to any controller, prioritize asking questions first: inquire whether there are already integrated clients or dependent systems, so you can establish a strong background context and understand what changes are safe or compatible.
- Break down tasks into clear, executable steps (make each task explicit).
- For each task/step in your plan, display which files are affected by that specific task, providing the user with a clear starting point.
- Analyze the codebase to understand the current state.
- Identify what changes would be needed and where.
- Suggest alternative approaches and trade-offs.
- Estimate effort and complexity for each step.
- Do NOT write, modify, or create any code.
- Do NOT execute commands or make file changes.
- Do NOT create canvas nodes or emit canvas-control markers.
- Focus on planning, analysis, and recommendation.`,
    enabledTools: ["read_file", "list_files", "search_codebase", "web_search"],
    mcpServers: [],
    isBuiltIn: true,
    icon: "lightbulb",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  {
    id: BUILT_IN_SKILL_IDS.VFS_AGENT,
    name: "vfs-agent",
    description: "Internal reconciliation agent. Reads real files, writes only to the VFS. Not user-selectable.",
    /**
     * This system prompt is embedded directly as the background instruction for
     * graph reconciliation. It is NOT surfaced in user-facing skill dropdowns.
     */
    systemPrompt: `You are an AI coding agent specialized in virtual workspace reconciliation operations.
Your task is to implement code changes using the Virtual File System (VFS).

Guidelines & Standards:
- You MAY read any file from the real project using 'read_file' to understand the existing codebase.
- All code write operations (new files, edits, deletions) MUST be performed in the VFS using 'write_file'.
- Do NOT modify real physical project files.
- Implement the requested features step-by-step, ensuring clean and maintainable code.
- Write full, complete file content when saving changes.
- Focus strictly on the instructions: \${instructions}

Design & Aesthetic Principles:
- Prioritize premium UI design. Implement visually rich styles with curated HSL color schemes and smooth transitions.
- Apply modern, highly readable typography (e.g., system-ui, Inter, Roboto, Outfit) instead of default browser fonts.
- Embed subtle micro-animations for hover states and active indicators.

SEO & Structural Best Practices:
- Structure HTML5 markup semantically (using headers, sections, main, etc.).
- Ensure interactive elements are designated with unique, descriptive "id" attributes for automated test selection.
- Set appropriate document structures and outlines.`,
    enabledTools: ["read_file", "write_file", "list_files", "search_codebase", "web_search"],
    mcpServers: [],
    isBuiltIn: true,
    isInternal: true,
    icon: "database",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves a Skill object from a list given a preferred ID.
 *
 * Resolution order:
 *  1. `preferredId` exists in the list → return it
 *  2. Fall back to `DEFAULT_SKILL_ID` (build)
 *  3. Fall back to first item in the list
 *  4. Return null if the list is empty
 */
export function resolveSkill(skills: Skill[], preferredId: string | null | undefined): Skill | null {
  if (preferredId) {
    const found = skills.find((s) => s.id === preferredId);
    if (found) return found;
  }
  const defaultSkill = skills.find((s) => s.id === DEFAULT_SKILL_ID);
  if (defaultSkill) return defaultSkill;
  return skills[0] ?? null;
}

/**
 * The skill payload a run receives. `mcpServers` feeds the session's execution
 * policy (skillExecutionPolicy.ts) -- dropping it silently denies every MCP
 * server to every skill.
 */
export function toSkillData(skill: Skill | null): {
  name: string;
  systemPrompt: string;
  enabledTools: string[];
  mcpServers: string[];
  preferredModel?: string;
  skillId: string;
} | null {
  if (!skill) return null;
  return {
    name: skill.name,
    systemPrompt: skill.systemPrompt,
    enabledTools: skill.enabledTools,
    mcpServers: skill.mcpServers ?? [],
    preferredModel: skill.preferredModel,
    skillId: skill.isBuiltIn ? skill.id : "",
  };
}
