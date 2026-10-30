/**
 * Deterministic layered layout.
 *
 * The same graph always yields the same positions, so a refresh that changes nothing moves
 * nothing. Steps: break cycles by depth-first order over sorted keys, assign layers by longest
 * path, order each layer with a barycenter sweep (ties broken by key), then place layers left to
 * right. Nodes without edges are packed into a grid below the layered part. A manually pinned
 * position always wins. Pure: no React, store, or Tauri imports.
 */

export interface LayoutNode {
  key: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutOptions {
  layerGap: number;
  nodeGap: number;
  /** Columns in the grid of unconnected nodes. */
  isolatedColumns: number;
  /** Barycenter sweeps (each is one downward and one upward pass). */
  sweeps: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  layerGap: 280,
  nodeGap: 110,
  isolatedColumns: 5,
  sweeps: 4,
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  pinned: Readonly<Record<string, Point>> = {},
  options: Partial<LayoutOptions> = {},
): Record<string, Point> {
  const settings = { ...DEFAULT_LAYOUT, ...options };
  const keys = [...new Set(nodes.map((node) => node.key))].sort(compare);
  const known = new Set(keys);

  // Distinct edges between known, different nodes.
  const successors = new Map<string, string[]>(keys.map((key) => [key, []]));
  const seen = new Set<string>();
  for (const edge of edges) {
    const id = `${edge.from}\u0000${edge.to}`;
    if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to) || seen.has(id)) continue;
    seen.add(id);
    successors.get(edge.from)!.push(edge.to);
  }
  for (const list of successors.values()) list.sort(compare);

  const touched = new Set<string>();
  for (const [from, targets] of successors) {
    if (targets.length) touched.add(from);
    for (const target of targets) touched.add(target);
  }
  const connected = keys.filter((key) => touched.has(key));
  const isolated = keys.filter((key) => !touched.has(key));

  const positions: Record<string, Point> = {};
  const layers = assignLayers(connected, successors);
  const ordered = orderLayers(layers, successors, settings.sweeps);
  const tallest = Math.max(0, ...ordered.map((layer) => layer.length));
  ordered.forEach((layer, layerIndex) => {
    layer.forEach((key, index) => {
      positions[key] = {
        x: layerIndex * settings.layerGap,
        y: (index - (layer.length - 1) / 2) * settings.nodeGap,
      };
    });
  });

  const gridTop = ((tallest + 1) * settings.nodeGap) / 2 + (connected.length ? settings.nodeGap : 0);
  isolated.forEach((key, index) => {
    positions[key] = {
      x: (index % settings.isolatedColumns) * (settings.layerGap * 0.75),
      y: gridTop + Math.floor(index / settings.isolatedColumns) * settings.nodeGap,
    };
  });

  for (const [key, point] of Object.entries(pinned)) {
    if (known.has(key)) positions[key] = point;
  }
  return positions;
}

/** Longest-path layering after ignoring the back edges found by a sorted depth-first search. */
function assignLayers(keys: string[], successors: Map<string, string[]>): string[][] {
  const forward = new Map<string, string[]>(keys.map((key) => [key, []]));
  const state = new Map<string, "open" | "done">();
  const visit = (start: string) => {
    // Iterative to survive very deep chains.
    const stack: { key: string; next: number }[] = [{ key: start, next: 0 }];
    state.set(start, "open");
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const targets = successors.get(frame.key)!;
      if (frame.next < targets.length) {
        const target = targets[frame.next++];
        const status = state.get(target);
        if (status === "open") continue; // back edge: dropped from layering
        forward.get(frame.key)!.push(target);
        if (!status) {
          state.set(target, "open");
          stack.push({ key: target, next: 0 });
        }
      } else {
        state.set(frame.key, "done");
        stack.pop();
      }
    }
  };
  for (const key of keys) if (!state.has(key)) visit(key);

  // Kahn's algorithm in rounds: a node's round is its longest-path layer.
  const indegree = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const targets of forward.values()) for (const target of targets) indegree.set(target, indegree.get(target)! + 1);
  const result: string[][] = [];
  let ready = keys.filter((key) => indegree.get(key) === 0);
  while (ready.length) {
    ready.sort(compare);
    result.push(ready);
    const next: string[] = [];
    for (const key of ready) {
      for (const target of forward.get(key)!) {
        indegree.set(target, indegree.get(target)! - 1);
        if (indegree.get(target) === 0) next.push(target);
      }
    }
    ready = next;
  }
  return result;
}

/** Reduces crossings by sorting each layer by the mean position of its neighbours. */
function orderLayers(layers: string[][], successors: Map<string, string[]>, sweeps: number): string[][] {
  const predecessors = new Map<string, string[]>();
  for (const [from, targets] of successors) for (const to of targets) (predecessors.get(to) ?? predecessors.set(to, []).get(to)!).push(from);
  const order = layers.map((layer) => [...layer].sort(compare));
  const positions = new Map<string, number>();
  const record = (layer: string[]) => layer.forEach((key, position) => positions.set(key, position));
  order.forEach(record);
  const sortBy = (layer: string[], neighbours: Map<string, string[]>) =>
    layer
      .map((key) => {
        const near = (neighbours.get(key) ?? []).filter((n) => positions.has(n));
        const mean = near.length ? near.reduce((sum, n) => sum + positions.get(n)!, 0) / near.length : positions.get(key)!;
        return { key, mean };
      })
      .sort((a, b) => a.mean - b.mean || compare(a.key, b.key))
      .map((entry) => entry.key);
  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let i = 1; i < order.length; i++) {
      order[i] = sortBy(order[i], predecessors);
      record(order[i]);
    }
    for (let i = order.length - 2; i >= 0; i--) {
      order[i] = sortBy(order[i], successors);
      record(order[i]);
    }
  }
  return order;
}
