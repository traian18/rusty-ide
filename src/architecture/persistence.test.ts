import { describe, expect, it } from "vitest";
import {
  addNote, deleteNote, DOCUMENT_VERSION, editNote, emptyDocument, MAX_NOTE_LENGTH,
  MAX_POSITIONS_PER_VIEW, parseDocument, reconcileNotes, withLayout, withoutPosition,
} from "./persistence";
import { fileKey, groupKey } from "./identity";

describe("saved document", () => {
  it("starts empty when nothing was saved", () => {
    expect(parseDocument(null)).toEqual({ document: emptyDocument(), warning: null });
  });

  it("round-trips a document unchanged", () => {
    let document = emptyDocument();
    document = withLayout(document, "overview:declared_package", { [groupKey("g1")]: { x: 1, y: 2 } });
    document = addNote(document, fileKey("src/a.rs"), "  careful here ", 10, "n1");
    document = { ...document, view: { importKind: "runtime", colorMode: "severity", edgeShare: 60, spacing: 220, frameworks: true } };
    const parsed = parseDocument(JSON.parse(JSON.stringify(document)));
    expect(parsed.warning).toBeNull();
    expect(parsed.document).toEqual(document);
    expect(parsed.document.notes[0].text).toBe("careful here");
  });

  it("ignores a document from another version rather than misreading it", () => {
    const parsed = parseDocument({ version: DOCUMENT_VERSION + 1, notes: [{ id: "x" }] });
    expect(parsed.document).toEqual(emptyDocument());
    expect(parsed.warning).toMatch(/different version/);
  });

  it("skips unreadable items, keeps the rest, and says how many were skipped", () => {
    const parsed = parseDocument({
      version: DOCUMENT_VERSION,
      layouts: { v: { "file:a": { x: 1, y: 2 }, "file:b": { x: "no", y: 2 }, bogus: { x: 1, y: 1 } }, broken: 5 },
      view: { kind: "nonsense", importKind: "runtime" },
      notes: [
        { id: "ok", node: "file:a", text: "hi", created: 1, updated: 2 },
        { id: "bad", node: "nope", text: "x", created: 1, updated: 2 },
        "garbage",
      ],
    });
    expect(parsed.document.layouts.v).toEqual({ "file:a": { x: 1, y: 2 } });
    expect(parsed.document.notes.map((n) => n.id)).toEqual(["ok"]);
    expect(parsed.document.view).toEqual({ importKind: "runtime", colorMode: "node", edgeShare: 100, spacing: 160, frameworks: false });
    expect(parsed.warning).toMatch(/5 saved items/);
  });

  it("reads the levelled-view settings and ignores values it does not know", () => {
    const good = parseDocument({ version: DOCUMENT_VERSION, view: { colorMode: "kind", edgeShare: 50.4, spacing: 199.6 } });
    expect(good.document.view).toMatchObject({ colorMode: "kind", edgeShare: 50, spacing: 200 });
    // The old key is ignored on purpose: it defaulted to a colouring that made every node look alike.
    expect(parseDocument({ version: DOCUMENT_VERSION, view: { colorBy: "language" } }).document.view.colorMode).toBe("node");
    const bad = parseDocument({ version: DOCUMENT_VERSION, view: { colorMode: "mood", edgeCoverage: 5 } });
    expect(bad.document.view).toMatchObject({ colorMode: "node", edgeShare: 100, spacing: 160 });
  });

  it("caps note length when reading and writing", () => {
    const long = "x".repeat(MAX_NOTE_LENGTH + 50);
    const added = addNote(emptyDocument(), fileKey("a"), long, 1, "n");
    expect(added.notes[0].text).toHaveLength(MAX_NOTE_LENGTH);
    const parsed = parseDocument({ ...added, notes: [{ ...added.notes[0], text: long }] });
    expect(parsed.document.notes[0].text).toHaveLength(MAX_NOTE_LENGTH);
  });
});

describe("notes", () => {
  it("adds, edits, and deletes; blank text changes nothing", () => {
    let document = addNote(emptyDocument(), groupKey("g"), "first", 1, "a");
    expect(addNote(document, groupKey("g"), "   ", 2, "b")).toBe(document);
    document = editNote(document, "a", "second", 5);
    expect(document.notes[0]).toMatchObject({ text: "second", created: 1, updated: 5 });
    expect(editNote(document, "a", " ", 6)).toBe(document);
    expect(deleteNote(document, "a").notes).toEqual([]);
    expect(deleteNote(document, "missing").notes).toHaveLength(1);
  });

  it("orphans notes whose node vanished but never drops them", () => {
    let document = addNote(emptyDocument(), fileKey("old.rs"), "gone", 1, "n1");
    document = addNote(document, fileKey("kept.rs"), "here", 1, "n2");
    const { attached, orphaned } = reconcileNotes(document.notes, new Set([fileKey("kept.rs")]));
    expect(attached.map((n) => n.id)).toEqual(["n2"]);
    expect(orphaned.map((n) => n.id)).toEqual(["n1"]);
    // When the node comes back the note re-attaches.
    expect(reconcileNotes(document.notes, new Set([fileKey("old.rs"), fileKey("kept.rs")])).orphaned).toEqual([]);
  });
});

describe("layouts", () => {
  it("merges positions, remembering nodes that are not currently shown", () => {
    let document = withLayout(emptyDocument(), "v", { "file:a": { x: 1, y: 1 } });
    document = withLayout(document, "v", { "file:b": { x: 2, y: 2 } });
    expect(Object.keys(document.layouts.v)).toEqual(["file:a", "file:b"]);
    expect(withoutPosition(document, "v", "file:a").layouts.v).toEqual({ "file:b": { x: 2, y: 2 } });
    expect(document.layouts.v["file:a"]).toBeDefined();
  });

  it("is bounded per view, dropping the lexically last keys", () => {
    const positions = Object.fromEntries(
      Array.from({ length: MAX_POSITIONS_PER_VIEW + 10 }, (_, i) => [`file:${String(i).padStart(6, "0")}`, { x: i, y: i }]),
    );
    const kept = Object.keys(withLayout(emptyDocument(), "v", positions).layouts.v);
    expect(kept).toHaveLength(MAX_POSITIONS_PER_VIEW);
    expect(kept[0]).toBe("file:000000");
  });
});
