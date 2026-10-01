import { describe, expect, it } from "vitest";

import {
  MAX_GLOB_MATCHES,
  MAX_LISTING_LINES,
  globToRegExp,
  normalizeBase,
  renderGlobMatches,
  renderListing,
  resolveDepth,
  resolveWorkspacePath,
  type ListingEntry,
} from "./fileListing";

const file = (name: string): ListingEntry => ({ name, path: `/ws/${name}`, is_dir: false });
const dir = (name: string, children?: ListingEntry[], entries?: number): ListingEntry => ({ name, path: `/ws/${name}`, is_dir: true, children, entries });

describe("resolveWorkspacePath", () => {
  it("joins relative paths onto the root and leaves absolute and ~ paths alone", () => {
    expect(resolveWorkspacePath("/ws", "src/a.ts")).toBe("/ws/src/a.ts");
    expect(resolveWorkspacePath("/ws/", "src/a.ts")).toBe("/ws/src/a.ts");
    expect(resolveWorkspacePath("/ws", "/etc/hosts")).toBe("/etc/hosts");
    expect(resolveWorkspacePath("/ws", "~/notes.md")).toBe("~/notes.md");
    expect(resolveWorkspacePath("C:\\ws", "src\\a.ts")).toBe("C:\\ws\\src\\a.ts");
    expect(resolveWorkspacePath("/ws", "D:\\x")).toBe("D:\\x");
  });
});

describe("normalizeBase", () => {
  it("treats empty and dot paths as the workspace root", () => {
    for (const root of ["", " ", ".", "./", "  ./  "]) expect(normalizeBase(root)).toBe("");
  });

  it("drops a leading ./ and trailing slashes, and keeps absolute paths", () => {
    expect(normalizeBase("./src/")).toBe("src");
    expect(normalizeBase("src\\components")).toBe("src/components");
    expect(normalizeBase("/etc/")).toBe("/etc");
    expect(normalizeBase("/")).toBe("/");
  });
});

describe("resolveDepth", () => {
  it("clamps to 1..8, accepts numeric strings, and falls back on anything else", () => {
    expect(resolveDepth(3, 1)).toBe(3);
    expect(resolveDepth("2", 1)).toBe(2);
    expect(resolveDepth(0, 1)).toBe(1);
    expect(resolveDepth(99, 1)).toBe(8);
    expect(resolveDepth(2.9, 1)).toBe(2);
    for (const bad of [undefined, null, "deep", NaN, {}]) expect(resolveDepth(bad, 4)).toBe(4);
  });
});

describe("globToRegExp", () => {
  const matches = (glob: string, path: string) => globToRegExp(glob).test(path);

  it("keeps * inside a folder and lets ** cross folders", () => {
    expect(matches("src/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/*.ts", "src/deep/a.ts")).toBe(false);
    expect(matches("src/**/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/**/*.ts", "src/x/y/a.ts")).toBe(true);
    expect(matches("src/**/*.ts", "lib/a.ts")).toBe(false);
    expect(matches("src/**", "src/x/y/a.ts")).toBe(true);
  });

  it("matches a bare name at any depth, like find -name", () => {
    expect(matches("package.json", "package.json")).toBe(true);
    expect(matches("package.json", "apps/web/package.json")).toBe(true);
    expect(matches("package.json", "apps/web/package.json.bak")).toBe(false);
    expect(matches("*.test.ts", "src/a.test.ts")).toBe(true);
  });

  it("supports ? and {a,b} alternatives", () => {
    expect(matches("src/?.ts", "src/a.ts")).toBe(true);
    expect(matches("src/?.ts", "src/ab.ts")).toBe(false);
    expect(matches("**/*.{ts,tsx}", "a/b.tsx")).toBe(true);
    expect(matches("**/*.{ts,tsx}", "a/b.js")).toBe(false);
    expect(matches("{src,lib}/index.ts", "lib/index.ts")).toBe(true);
  });

  it("treats everything else literally, so a dot is not a wildcard", () => {
    expect(matches("src/a.ts", "src/aXts")).toBe(false);
    expect(matches("src/(a)+.ts", "src/(a)+.ts")).toBe(true);
    expect(matches("a,b/c.ts", "a,b/c.ts")).toBe(true);
    expect(() => globToRegExp("src/{unclosed")).not.toThrow();
    expect(() => globToRegExp("}/x[")).not.toThrow();
  });

  it("ignores a leading ./", () => {
    expect(matches("./src/*.ts", "src/a.ts")).toBe(true);
  });
});

describe("renderListing", () => {
  it("shows one level with trailing slashes and what each unopened folder holds", () => {
    const text = renderListing("", 1, {
      entries: [dir("src", undefined, 3), dir("docs", undefined, 1), dir("empty", [], undefined), file("README.md")],
      truncated: false,
    });
    expect(text).toBe([". (1 level):", "src/ (3 entries)", "docs/ (1 entry)", "empty/ (empty)", "README.md"].join("\n"));
  });

  it("indents nested levels and names the directory it is for", () => {
    const text = renderListing("rusty-ide", 2, {
      entries: [dir("src", [file("main.ts"), dir("lib", undefined, 4)]), file("package.json")],
      truncated: false,
    });
    expect(text).toBe(["rusty-ide/ (2 levels):", "src/", "  main.ts", "  lib/ (4 entries)", "package.json"].join("\n"));
  });

  it("says so when a directory is empty", () => {
    expect(renderListing("empty", 1, { entries: [], truncated: false })).toBe("empty/ (1 level): empty.");
  });

  it("caps very long listings and explains how to narrow them", () => {
    const entries = Array.from({ length: MAX_LISTING_LINES + 25 }, (_, i) => file(`f${i}.txt`));
    const text = renderListing("", 1, { entries, truncated: false });
    expect(text.split("\n")).toHaveLength(1 + MAX_LISTING_LINES + 1);
    expect(text).toContain("... and 25 more lines");
  });

  it("warns when the walk itself was cut short", () => {
    expect(renderListing("", 1, { entries: [file("a")], truncated: true })).toContain("too large to list completely");
  });
});

describe("renderGlobMatches", () => {
  const tree = {
    entries: [
      dir("apps", [dir("web", [file("package.json"), file("index.ts")]), dir("api", [file("package.json")])]),
      file("package.json"),
      file("README.md"),
    ],
    truncated: false,
  };

  it("lists matching files as workspace-relative paths a model can read", () => {
    expect(renderGlobMatches("", "package.json", tree)).toBe(
      ["3 files match package.json in the workspace:", "apps/web/package.json", "apps/api/package.json", "package.json"].join("\n"),
    );
  });

  it("matches relative to the listed folder but reports paths from the workspace", () => {
    const inside = { entries: [dir("web", [file("package.json")])], truncated: false };
    expect(renderGlobMatches("apps", "**/package.json", inside)).toBe(
      ["1 file matches **/package.json in apps/:", "apps/web/package.json"].join("\n"),
    );
  });

  it("only matches files, not folders", () => {
    expect(renderGlobMatches("", "web", tree)).toBe("No files in the workspace match web.");
  });

  it("caps the matches and flags an incomplete search", () => {
    const entries = Array.from({ length: MAX_GLOB_MATCHES + 7 }, (_, i) => file(`n${i}.ts`));
    const text = renderGlobMatches("", "*.ts", { entries, truncated: true });
    expect(text).toContain(`${MAX_GLOB_MATCHES + 7} files match`);
    expect(text).toContain("... and 7 more matches");
    expect(text).toContain("some matches may be missing");
    expect(renderGlobMatches("", "*.zzz", { entries: [], truncated: true })).toContain("too large to search completely");
  });
});
