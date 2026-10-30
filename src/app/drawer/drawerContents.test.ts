import { describe, expect, it } from "vitest";

// The drawer loads these two chunks lazily; a broken target would only fail on first open.
describe("drawer lazy content", () => {
  it("resolves the file tree chunk to a component", async () => {
    const module = await import("../../features/explorer/ui");
    expect(module.FileTree).toBeTypeOf("function");
  });

  it("resolves the source control chunk to a component", async () => {
    const module = await import("../../features/git/ui");
    expect(module.SourceControl).toBeTypeOf("function");
  });
});
