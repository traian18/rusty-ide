import { describe, it, expect } from "vitest";
import { parseDragData, getDefaultContextName, formatRelativePath } from "./helpers";
import type { SearchMatch } from "../../../services/searchService";

describe("ContextNode helpers and attachment parsing", () => {
  it("formats default context name correctly", () => {
    expect(getDefaultContextName("README.md")).toBe("Context: README.md");
    expect(getDefaultContextName("config.json")).toBe("Context: config.json");
  });

  it("formats relative path when rootPath is prefix", () => {
    const match: SearchMatch = {
      path: "/Users/dev/project/src/index.ts",
      name: "index.ts",
      line: 0,
      content: "index.ts",
      is_content_match: false,
    };
    expect(formatRelativePath("/Users/dev/project", match)).toBe("/src/index.ts");
  });

  it("returns raw path when rootPath does not match (external file)", () => {
    const match: SearchMatch = {
      path: "/etc/hosts",
      name: "hosts",
      line: 0,
      content: "hosts",
      is_content_match: false,
    };
    expect(formatRelativePath("/Users/dev/project", match)).toBe("/etc/hosts");
    expect(formatRelativePath(undefined, match)).toBe("/etc/hosts");
  });

  it("parses valid JSON drag data from Rusty file tree", () => {
    const raw = JSON.stringify({
      path: "/Users/dev/project/file.ts",
      name: "file.ts",
      isDir: false,
    });
    const parsed = parseDragData(raw);
    expect(parsed).toEqual({
      path: "/Users/dev/project/file.ts",
      name: "file.ts",
      isDir: false,
    });
  });

  it("returns null for invalid or non-JSON drag payload", () => {
    expect(parseDragData("not json")).toBeNull();
    expect(parseDragData(JSON.stringify({ other: 123 }))).toBeNull();
  });

  it("handles external path display names with getDefaultContextName", () => {
    expect(getDefaultContextName("external-config.yaml")).toBe("Context: external-config.yaml");
    expect(getDefaultContextName("notes.txt")).toBe("Context: notes.txt");
  });
});
