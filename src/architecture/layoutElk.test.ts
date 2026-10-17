import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import { layoutLevel, type ElkLike, type LevelLayoutInput } from "./layoutElk";

const elk = new ELK() as unknown as ElkLike;
const item = (id: string, parent: string | null = null) => ({ id, parent, width: 160, height: 64 });

const input: LevelLayoutInput = {
  items: [item("c"), item("a"), item("b"), item("frame"), item("inner1", "frame"), item("inner2", "frame")],
  links: [
    { id: "a->b", from: "a", to: "b" },
    { id: "b->c", from: "b", to: "c" },
    { id: "inner1->inner2", from: "inner1", to: "inner2" },
    { id: "a->inner1", from: "a", to: "inner1" },
  ],
};

describe("layoutLevel", () => {
  it("gives the same boxes for the same graph, whatever the input order", async () => {
    const first = await layoutLevel(input, elk);
    const shuffled = await layoutLevel({ items: [...input.items].reverse(), links: [...input.links].reverse() }, elk);
    expect(first.engine).toBe("elk");
    expect(shuffled.boxes).toEqual(first.boxes);
  });

  it("lays a flat level out as compact, non-overlapping clusters", async () => {
    const items = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, parent: null, width: 140, height: 100 }));
    const links = [["a", "b"], ["a", "c"], ["a", "d"], ["a", "e"], ["a", "f"]].map(([from, to]) => ({ id: `${from}->${to}`, from, to }));
    const { boxes, engine } = await layoutLevel({ items, links }, elk);
    expect(engine).toBe("elk");
    const placed = Object.values(boxes);
    for (const [i, one] of placed.entries()) {
      for (const other of placed.slice(i + 1)) {
        const apart = one.x + one.width <= other.x || other.x + other.width <= one.x || one.y + one.height <= other.y || other.y + other.height <= one.y;
        expect(apart).toBe(true);
      }
    }
    const width = Math.max(...placed.map((b) => b.x + b.width)) - Math.min(...placed.map((b) => b.x));
    const height = Math.max(...placed.map((b) => b.y + b.height)) - Math.min(...placed.map((b) => b.y));
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(4);
  });

  it("puts nodes further apart when asked to space them out", async () => {
    const items = [item("a"), item("b")];
    const links = [{ id: "a->b", from: "a", to: "b" }];
    const distance = async (spacing: number) => {
      const { boxes } = await layoutLevel({ items, links, spacing }, elk);
      return Math.hypot(boxes.a.x - boxes.b.x, boxes.a.y - boxes.b.y);
    };
    expect(await distance(200)).toBeGreaterThan(await distance(100) * 1.5);
    expect(await distance(100)).toBeGreaterThan(await distance(50));
  });

  it("frames the top-level items without laying the frame out", async () => {
    const framed = await layoutLevel({ items: [{ id: "frame", parent: null, width: 0, height: 0 }, { ...item("a"), parent: "frame" }, { ...item("b"), parent: "frame" }], links: [{ id: "a->b", from: "a", to: "b" }], frame: "frame" }, elk);
    const { frame, a, b } = framed.boxes;
    expect(framed.flattened).toBe(false);
    for (const child of [a, b]) {
      expect(child.x).toBeGreaterThan(0);
      expect(child.y).toBeGreaterThan(0);
      expect(child.x + child.width).toBeLessThan(frame.width);
      expect(child.y + child.height).toBeLessThan(frame.height);
    }
    const again = await layoutLevel({ items: [{ id: "frame", parent: null, width: 0, height: 0 }, { ...item("b"), parent: "frame" }, { ...item("a"), parent: "frame" }], links: [{ id: "a->b", from: "a", to: "b" }], frame: "frame" }, elk);
    expect(again.boxes).toEqual(framed.boxes);
  });

  it("lays connected nodes out in layers from left to right", async () => {
    const { boxes } = await layoutLevel(input, elk);
    expect(boxes.a.x).toBeLessThan(boxes.b.x);
    expect(boxes.b.x).toBeLessThan(boxes.c.x);
  });

  it("sizes a compound node around its children and positions children inside it", async () => {
    const { boxes } = await layoutLevel(input, elk);
    expect(boxes.frame.width).toBeGreaterThan(160);
    for (const child of ["inner1", "inner2"]) {
      expect(boxes[child].x).toBeGreaterThanOrEqual(0);
      expect(boxes[child].x + boxes[child].width).toBeLessThanOrEqual(boxes.frame.width);
      expect(boxes[child].y + boxes[child].height).toBeLessThanOrEqual(boxes.frame.height);
    }
  });

  it("keeps a pinned position over the computed one", async () => {
    const { boxes } = await layoutLevel({ ...input, pinned: { b: { x: 999, y: -5 } } }, elk);
    expect([boxes.b.x, boxes.b.y]).toEqual([999, -5]);
  });

  it("ignores links to unknown items and self links", async () => {
    const result = await layoutLevel({ items: [item("a")], links: [{ id: "x", from: "a", to: "ghost" }, { id: "y", from: "a", to: "a" }] }, elk);
    expect(Object.keys(result.boxes)).toEqual(["a"]);
  });

  it("falls back to the in-house layout when ELK fails, saying so", async () => {
    const broken: ElkLike = { layout: async () => { throw new Error("boom"); } };
    const result = await layoutLevel(input, broken);
    expect(result.engine).toBe("fallback");
    expect(result.flattened).toBe(true);
    expect(Object.keys(result.boxes).sort()).toEqual(["a", "b", "c", "frame", "inner1", "inner2"]);
  });

  it("falls back when ELK takes too long", async () => {
    const stuck: ElkLike = { layout: () => new Promise(() => undefined) };
    expect((await layoutLevel(input, stuck, 20)).engine).toBe("fallback");
  });

  it("falls back when no engine could be loaded", async () => {
    expect((await layoutLevel(input, null)).engine).toBe("fallback");
  });
});
