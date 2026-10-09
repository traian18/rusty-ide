import { describe, expect, it, vi } from "vitest";
import { requestFileTreeSelectionOnBlameEnable } from "./fileTabBlame";

describe("requestFileTreeSelectionOnBlameEnable", () => {
  it("selects a physical file when blame is enabled", () => {
    const select = vi.fn();

    expect(requestFileTreeSelectionOnBlameEnable(false, "/ws/src/main.ts", undefined, false, select)).toBe(true);
    expect(select).toHaveBeenCalledWith("/ws/src/main.ts");
  });

  it("does not select when disabling blame or for unsupported files", () => {
    const select = vi.fn();

    expect(requestFileTreeSelectionOnBlameEnable(true, "/ws/src/main.ts", undefined, false, select)).toBe(false);
    expect(requestFileTreeSelectionOnBlameEnable(false, "/ws/src/image.png", undefined, true, select)).toBe(false);
    expect(requestFileTreeSelectionOnBlameEnable(false, "vfs://notes", "vfs-1", false, select)).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it("requests selection independently of Git blame command results", () => {
    const select = vi.fn();

    requestFileTreeSelectionOnBlameEnable(false, "/ws/src/main.ts", undefined, false, select);

    expect(select).toHaveBeenCalledTimes(1);
  });
});
