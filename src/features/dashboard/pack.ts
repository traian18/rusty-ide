/**
 * Circle packing of the folder tree: each file is a circle whose area follows its weight, and each
 * folder is the circle around its children. Siblings are packed with a front chain (each new
 * circle is placed against two circles on the outer chain, then the chain is repaired where it
 * overlaps); the circle around them is approximate, which only costs a little empty margin.
 */
import type { PathNode } from "./pathTree";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface PackedCircle<T> extends Circle {
  node: PathNode<T>;
  depth: number;
}

interface Link {
  c: Circle;
  next: Link;
  prev: Link;
}

const EPSILON = 1e-6;

function overlaps(a: Circle, b: Circle): boolean {
  const reach = a.r + b.r - EPSILON;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return reach > 0 && reach * reach > dx * dx + dy * dy;
}

/** Puts `c` against both `a` and `b`, on the left of the line from `a` to `b`. */
function touch(a: Circle, b: Circle, c: Circle): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (!d2) {
    c.x = a.x + a.r + c.r;
    c.y = a.y;
    return;
  }
  const ra = (a.r + c.r) ** 2;
  const rb = (b.r + c.r) ** 2;
  // Distance along a→b to the foot of c, and the perpendicular offset, both as fractions of |ab|.
  const along = (d2 + ra - rb) / (2 * d2);
  const across = Math.sqrt(Math.max(0, ra / d2 - along * along));
  c.x = a.x + along * dx - across * dy;
  c.y = a.y + along * dy + across * dx;
}

/** How far the tangent point between a link and the next sits from the origin; the chain grows from the closest. */
function closeness(link: Link): number {
  const a = link.c;
  const b = link.next.c;
  const sum = a.r + b.r;
  const x = (a.x * b.r + b.x * a.r) / sum;
  const y = (a.y * b.r + b.y * a.r) / sum;
  return x * x + y * y;
}

/** Positions `circles` (radii set) around the origin without overlap. Mutates x and y. */
export function packSiblings(circles: Circle[]): void {
  const n = circles.length;
  if (!n) return;
  const [first, second, third] = circles;
  first.x = 0;
  first.y = 0;
  if (n === 1) return;
  first.x = -second.r;
  second.x = first.r;
  second.y = 0;
  if (n === 2) return;
  touch(second, first, third);
  const a0 = { c: first } as Link;
  const b0 = { c: second } as Link;
  const c0 = { c: third } as Link;
  a0.next = c0.prev = b0;
  b0.next = a0.prev = c0;
  c0.next = b0.prev = a0;
  let a = a0;
  let b = b0;
  next: for (let i = 3; i < n; i += 1) {
    const circle = circles[i];
    touch(a.c, b.c, circle);
    // Walk the chain both ways from a and b, nearest first, looking for an overlap.
    let forward = b.next;
    let backward = a.prev;
    let walkedForward = b.c.r;
    let walkedBackward = a.c.r;
    do {
      if (walkedForward <= walkedBackward) {
        if (overlaps(forward.c, circle)) {
          b = forward;
          a.next = b;
          b.prev = a;
          i -= 1;
          continue next;
        }
        walkedForward += forward.c.r;
        forward = forward.next;
      } else {
        if (overlaps(backward.c, circle)) {
          a = backward;
          a.next = b;
          b.prev = a;
          i -= 1;
          continue next;
        }
        walkedBackward += backward.c.r;
        backward = backward.prev;
      }
    } while (forward !== backward.next);
    const link = { c: circle, prev: a, next: b } as Link;
    a.next = link;
    b.prev = link;
    b = link;
    // Grow next from the closest gap on the chain, so the pack stays round.
    let best = closeness(a);
    for (let cursor = link.next; cursor !== b; cursor = cursor.next) {
      const score = closeness(cursor);
      if (score < best) {
        a = cursor;
        best = score;
      }
    }
    b = a.next;
  }
}

/** A circle around all of `circles`: centred on their bounding box, so a little larger than the smallest. */
export function enclose(circles: readonly Circle[]): Circle {
  if (!circles.length) return { x: 0, y: 0, r: 0 };
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    minY = Math.min(minY, c.y - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const x = (minX + maxX) / 2;
  const y = (minY + maxY) / 2;
  const r = Math.max(...circles.map((c) => Math.hypot(c.x - x, c.y - y) + c.r));
  return { x, y, r };
}

interface Packed<T> extends Circle {
  node: PathNode<T>;
  children: Packed<T>[];
}

function packNode<T>(node: PathNode<T>, padding: number): Packed<T> {
  if (node.item !== undefined) return { node, children: [], x: 0, y: 0, r: Math.sqrt(Math.max(node.weight, EPSILON)) };
  const children = [...node.children].sort((a, b) => b.weight - a.weight).map((child) => packNode(child, padding));
  // Padding is packed in, then taken out again, so siblings keep a gap between them.
  children.forEach((child) => (child.r += padding));
  packSiblings(children);
  const around = enclose(children);
  children.forEach((child) => {
    child.r -= padding;
    child.x -= around.x;
    child.y -= around.y;
  });
  return { node, children, x: 0, y: 0, r: around.r };
}

/**
 * The whole tree packed into a circle of radius `radius` centred on the origin; parents come
 * before their children. `padding` is the gap between siblings, as a share of the mean file radius.
 */
export function packTree<T>(root: PathNode<T>, radius: number, padding = 0.25): PackedCircle<T>[] {
  const leaves: number[] = [];
  const visit = (node: PathNode<T>) => (node.item !== undefined ? leaves.push(Math.sqrt(Math.max(node.weight, EPSILON))) : node.children.forEach(visit));
  visit(root);
  if (!leaves.length) return [];
  const mean = leaves.reduce((a, b) => a + b, 0) / leaves.length;
  const packed = packNode(root, mean * padding);
  const scale = packed.r > 0 ? radius / packed.r : 1;
  const out: PackedCircle<T>[] = [];
  const emit = (p: Packed<T>, x: number, y: number, depth: number) => {
    out.push({ node: p.node, depth, x: x * scale, y: y * scale, r: p.r * scale });
    p.children.forEach((child) => emit(child, x + child.x, y + child.y, depth + 1));
  };
  emit(packed, 0, 0, 0);
  return out;
}
