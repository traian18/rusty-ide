// ============================================================
// generatedTaskGraph.ts — Parses the model's raw JSON response into a task
// graph. Ported verbatim from agent-sidecar/src/capabilities/
// generatedTaskGraph.ts (a separate npm package/compilation unit -- no
// shared module boundary for this logic, the same reason ExecutionProtocol
// exists twice in this codebase) so a core run validates/normalizes the
// model's output identically to the sidecar's own generate_task_nodes.
// ============================================================

export interface GeneratedTask {
  key: string;
  title: string;
  description: string;
  dependsOn: string[];
}

export interface GeneratedCodeContext {
  key: string;
  title: string;
  content: string;
  taskKeys: string[];
}

export interface GeneratedTaskGraph {
  tasks: GeneratedTask[];
  contexts: GeneratedCodeContext[];
}

export class InvalidTaskOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskOutputError";
  }
}

export function parseGeneratedTaskGraph(content: string): GeneratedTaskGraph {
  const trimmed = content.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  let parsed: any;
  try {
    parsed = JSON.parse(match?.[0] || trimmed);
  } catch {
    throw new InvalidTaskOutputError("The model returned malformed JSON.");
  }

  if (!Array.isArray(parsed?.tasks)) {
    throw new InvalidTaskOutputError('The model response did not contain a "tasks" array.');
  }

  const usedTaskKeys = new Set<string>();
  const tasks: GeneratedTask[] = (parsed.tasks as any[])
    .map((task: any, index: number) => {
      const title = String(task?.title || "").trim().slice(0, 120);
      const description = String(task?.description || "").trim().slice(0, 8000);
      if (!title || !description) return null;

      const requestedKey = String(task?.key || `task-${index + 1}`).trim().slice(0, 80) || `task-${index + 1}`;
      let key = requestedKey;
      let suffix = 2;
      while (usedTaskKeys.has(key)) key = `${requestedKey}-${suffix++}`;
      usedTaskKeys.add(key);

      const dependsOn = Array.isArray(task?.dependsOn)
        ? task.dependsOn.map((dependency: unknown) => String(dependency).trim()).filter(Boolean)
        : [];
      return { key, title, description, dependsOn };
    })
    .filter((task: GeneratedTask | null): task is GeneratedTask => task !== null)
    .slice(0, 20);

  if (!tasks.length) {
    throw new InvalidTaskOutputError("The model did not return any valid tasks.");
  }

  const earlierTaskKeys = new Set<string>();
  const normalizedTasks = tasks.map((task) => {
    const dependsOn = [...new Set<string>(task.dependsOn)].filter((dependency) => earlierTaskKeys.has(dependency));
    earlierTaskKeys.add(task.key);
    return { ...task, dependsOn };
  });

  const validTaskKeys = new Set(normalizedTasks.map((task) => task.key));
  const usedContextKeys = new Set<string>();
  const contexts: GeneratedCodeContext[] = (Array.isArray(parsed?.contexts) ? parsed.contexts : [])
    .map((context: any, index: number) => {
      const title = String(context?.title || `Code context ${index + 1}`).trim().slice(0, 120);
      const snippetContent = String(context?.content || "").trim().slice(0, 20_000);
      if (!snippetContent) return null;

      const requestedKey = String(context?.key || `context-${index + 1}`).trim().slice(0, 80) || `context-${index + 1}`;
      let key = requestedKey;
      let suffix = 2;
      while (usedContextKeys.has(key)) key = `${requestedKey}-${suffix++}`;
      usedContextKeys.add(key);

      const taskKeys = Array.isArray(context?.taskKeys)
        ? [...new Set<string>(context.taskKeys.map((taskKey: unknown) => String(taskKey).trim()))].filter((taskKey) =>
            validTaskKeys.has(taskKey),
          )
        : [];
      if (!taskKeys.length) return null;

      return { key, title, content: snippetContent, taskKeys };
    })
    .filter((context: GeneratedCodeContext | null): context is GeneratedCodeContext => context !== null)
    .slice(0, 30);

  return { tasks: normalizedTasks, contexts };
}
