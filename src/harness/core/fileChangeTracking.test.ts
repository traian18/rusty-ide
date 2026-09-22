import { describe, expect, it } from "vitest";
import { changedPathsFromTool } from "./fileChangeTracking";

describe("managed runtime file-change tracking", () => {
  it("extracts and resolves Codex file_change paths", () => {
    expect(changedPathsFromTool("file_change", {
      changes: [
        { kind: "update", path: "src/App.tsx" },
        { kind: "add", path: "/workspace/new.ts" },
        { kind: "update", path: "src/App.tsx" },
      ],
    }, "/workspace")).toEqual(["/workspace/src/App.tsx", "/workspace/new.ts"]);
  });

  it("extracts Claude Write and Edit paths", () => {
    expect(changedPathsFromTool("Write", { file_path: "src/new.ts" }, "/workspace"))
      .toEqual(["/workspace/src/new.ts"]);
    expect(changedPathsFromTool("Edit", { file_path: "/workspace/src/old.ts" }, "/workspace"))
      .toEqual(["/workspace/src/old.ts"]);
  });

  it("does not guess files from opaque shell commands or read tools", () => {
    expect(changedPathsFromTool("bash.exec", { command: "sed -i s/a/b/ src/a.ts" }, "/workspace")).toEqual([]);
    expect(changedPathsFromTool("read_file", { path: "src/a.ts" }, "/workspace")).toEqual([]);
  });
});
