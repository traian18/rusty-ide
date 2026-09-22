import type { GeneratedTaskNodeSpec } from "./types";

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const GENERATED_TASK_WIDTH = 320;
export const GENERATED_CONTEXT_WIDTH = 288;
export const GENERATED_CONTEXT_HEIGHT = 230;
export const GENERATED_NODE_GAP_X = 72;
export const GENERATED_NODE_GAP_Y = 56;

function estimateWrappedLines(text: string, charactersPerLine: number): number {
  return Math.max(1, text.split("\n").reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  ));
}

export function estimateTaskNodeHeight(description: string, minimized = false): number {
  if (minimized) return 178;
  return Math.max(190, 118 + estimateWrappedLines(description, 44) * 17);
}

export function estimateContextNodeHeight(description: string, minimized = false): number {
  if (minimized) return GENERATED_CONTEXT_HEIGHT;
  return Math.max(GENERATED_CONTEXT_HEIGHT, 170 + estimateWrappedLines(description, 38) * 18);
}

function overlapsWithGap(candidate: LayoutRect, occupied: LayoutRect): boolean {
  return candidate.x < occupied.x + occupied.width + GENERATED_NODE_GAP_X
    && candidate.x + candidate.width + GENERATED_NODE_GAP_X > occupied.x
    && candidate.y < occupied.y + occupied.height + GENERATED_NODE_GAP_Y
    && candidate.y + candidate.height + GENERATED_NODE_GAP_Y > occupied.y;
}

export function findAvailablePosition(
  occupied: LayoutRect[],
  desired: LayoutRect,
): LayoutRect {
  let candidate = { ...desired };
  for (let attempt = 0; attempt < 500; attempt++) {
    const collisions = occupied.filter((box) => overlapsWithGap(candidate, box));
    if (!collisions.length) return candidate;
    candidate = {
      ...candidate,
      y: Math.max(
        candidate.y + GENERATED_NODE_GAP_Y,
        ...collisions.map((box) => box.y + box.height + GENERATED_NODE_GAP_Y),
      ),
    };
  }
  return candidate;
}

export function calculateTaskDepths(tasks: GeneratedTaskNodeSpec[]): Map<string, number> {
  const depths = new Map<string, number>();
  tasks.forEach((task, index) => {
    const key = task.key || `task-${index + 1}`;
    const dependencyDepths = (task.dependsOn || [])
      .map((dependency) => depths.get(dependency))
      .filter((depth): depth is number => depth !== undefined);
    depths.set(key, dependencyDepths.length ? Math.max(...dependencyDepths) + 1 : 0);
  });
  return depths;
}
