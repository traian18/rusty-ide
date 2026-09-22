// ============================================================
// taskGenerationPrompt.ts — The system prompt and query-builder for
// generate_task_nodes. Ported verbatim from agent-sidecar/src/capabilities/
// taskGenerationPrompt.ts (see generatedTaskGraph.ts's own note on why this
// exists as a second copy) so a core run asks the exact same question the
// sidecar's own generate_task_nodes does.
// ============================================================

export interface TaskGenerationChatEntry {
  role: "user" | "assistant";
  content: string;
}

export const TASK_GENERATION_SYSTEM_PROMPT = `You extract an implementation graph from a product discussion. Return ONLY valid JSON with this exact shape: {"tasks":[{"key":"task-1","title":"short action-oriented title","description":"complete implementation instructions","dependsOn":[]},{"key":"task-2","title":"another title","description":"complete instructions","dependsOn":["task-1"]}],"contexts":[{"key":"context-1","title":"short code-context title","content":"verbatim code snippet including its Markdown fence when present","taskKeys":["task-1"]}]}. Each task and context key must be unique. dependsOn must contain only keys of earlier tasks. taskKeys must contain the keys of every task that needs that snippet as implementation context. Tasks must be specific, non-overlapping, ordered so prerequisites appear first, and based only on decisions established in the conversation and the user's additional instructions. Return 1 to 20 tasks and 0 to 30 contexts. Do not include canvas coordinates, markdown, commentary, or file changes outside the JSON strings.`;

export const TASK_GENERATION_DEPENDENCY_AUGMENTATION = `TASK DEPENDENCY AND CONNECTION REQUIREMENTS:
1. Preserve any dependency, ordering, independence, or parallelism that the user explicitly requested.
2. Use the final "Task Dependencies and Influence" section from the assistant's plan when it is present, translating every stated dependency into dependsOn keys.
3. If the user's messages do not explicitly define task relationships and the plan does not provide a usable dependency relationship, connect tasks sequentially in implementation order: the first task uses dependsOn: [], and every later task dependsOn the immediately preceding task's key.
4. Do not leave a later task disconnected merely because the user omitted dependency instructions. Use dependsOn: [] for a later task only when the user or plan explicitly establishes that it is independent or can run in parallel.
5. Every dependency must point to an earlier task key so the generated TaskNodes form a valid directed implementation graph.`;

export const TASK_GENERATION_CODE_CONTEXT_AUGMENTATION = `CODE-SNIPPET CONTEXT REQUIREMENTS:
1. Find code snippets in the user/assistant planning conversation, especially fenced Markdown code blocks and concrete inline examples that are intended to guide implementation.
2. Emit one contexts entry for each distinct useful snippet. Preserve the snippet verbatim in content, including its Markdown language fence when one exists; do not rewrite, complete, or invent code.
3. Set taskKeys to every generated task that needs the snippet. Do not create an unconnected context and do not attach a snippet to unrelated tasks.
4. Keep contexts empty when the planning conversation contains no useful code snippet.
5. The generated context will be injected into each connected TaskNode's prompt, so use a concise title that explains the snippet's purpose.`;

export function buildTaskGenerationQuery(history: TaskGenerationChatEntry[], additionalInstructions = ""): string {
  const conversation = history
    .slice(-30)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
    .join("\n\n");
  const normalizedAdditionalInstructions = additionalInstructions.trim();
  const additionalSection = normalizedAdditionalInstructions
    ? `\n\nADDITIONAL TASK-GENERATION INSTRUCTIONS:\n${normalizedAdditionalInstructions}`
    : "";

  return `${conversation}${additionalSection}\n\n${TASK_GENERATION_DEPENDENCY_AUGMENTATION}\n\n${TASK_GENERATION_CODE_CONTEXT_AUGMENTATION}`;
}
