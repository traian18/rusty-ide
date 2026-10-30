import { describe, expect, it } from "vitest";
import { absolutePath, navigationRequest } from "./navigation";

describe("navigationRequest", () => {
  it("opens an exact location at its line", () => {
    const { tab, notice } = navigationRequest("/work/app", { file: "src/a.rs", line: 12, column: 3 });
    expect(tab).toEqual({ type: "file", path: "/work/app/src/a.rs", line: 12 });
    expect(notice).toBeNull();
  });

  it("opens a stale location at the top and explains why", () => {
    const { tab, notice } = navigationRequest("/work/app", { file: "src/a.rs", line: 12, stale: true });
    expect(tab).toEqual({ type: "file", path: "/work/app/src/a.rs" });
    expect(notice).toMatch(/changed since/);
  });

  it("opens a file without a line when none is known", () => {
    for (const line of [undefined, null, 0, -3]) {
      expect(navigationRequest("/r", { file: "x.ts", line }).tab).toEqual({ type: "file", path: "/r/x.ts" });
    }
  });

  it("joins paths without doubled separators", () => {
    expect(absolutePath("/work/app/", "/src/a.rs")).toBe("/work/app/src/a.rs");
    expect(absolutePath("C:\\work\\app\\", "src\\a.rs")).toBe("C:\\work\\app/src\\a.rs");
  });
});
