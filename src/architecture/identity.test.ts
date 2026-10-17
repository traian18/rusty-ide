import { describe, expect, it } from "vitest";
import { fileKey, groupKey, isNodeKey, parseNodeKey } from "./identity";

describe("node keys", () => {
  it("round-trips groups and files, including ids containing colons", () => {
    expect(parseNodeKey(groupKey("declared_package:crates/x/Cargo.toml:x"))).toEqual({
      type: "group",
      id: "declared_package:crates/x/Cargo.toml:x",
    });
    expect(parseNodeKey(fileKey("src/a b/é.ts"))).toEqual({ type: "file", id: "src/a b/é.ts" });
  });

  it("rejects anything that is not a key", () => {
    for (const value of ["", "group:", "node:1", "file", 5, null, undefined, {}]) {
      expect(isNodeKey(value)).toBe(false);
    }
    expect(isNodeKey("file:x")).toBe(true);
  });

  it("keeps a file and a group with the same text apart", () => {
    expect(fileKey("x")).not.toBe(groupKey("x"));
  });
});
