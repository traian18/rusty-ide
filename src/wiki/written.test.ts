import { describe, expect, it } from "vitest";

import { formatTokens, linkPaths, splitDiagrams, writingOrder } from "./written";

describe("written pages", () => {
  it("splits a page at diagram markers that sit on their own line", () => {
    expect(splitDiagrams("## A\ntext [1].\n@@diagram:components@@\n## B\nmore [2].")).toEqual([
      { type: "markdown", text: "## A\ntext [1]." },
      { type: "diagram", key: "components" },
      { type: "markdown", text: "## B\nmore [2]." },
    ]);
    expect(splitDiagrams("inline @@diagram:x@@ stays")).toEqual([{ type: "markdown", text: "inline @@diagram:x@@ stays" }]);
  });

  it("links the files a page names, by full path or unique suffix, but not other code", () => {
    const paths = ["src/engine/run.rs", "web/app.ts"];
    expect(linkPaths("The `SessionEngine` in `src/engine/run.rs` and `app.ts`; run `npm run dev`.", paths)).toBe(
      "The `SessionEngine` in [`src/engine/run.rs`](#file:src/engine/run.rs) and [`app.ts`](#file:web/app.ts); run `npm run dev`.",
    );
    expect(linkPaths("```\n`src/engine/run.rs`\n```", paths)).toBe("```\n`src/engine/run.rs`\n```");
  });

  it("writes modules first and the overview after the pages it sums up", () => {
    const pages = ["overview", "glossary", "architecture", "module", "getting_started", "key_concepts", "how_it_works", "active_landscape"].map((kind) => ({ id: kind, kind }));
    expect(writingOrder(pages)).toEqual(["module", "architecture", "key_concepts", "how_it_works", "overview", "getting_started", "active_landscape", "glossary"]);
  });

  it("shortens token counts", () => {
    expect([formatTokens(950), formatTokens(12_400)]).toEqual(["950", "12.4k"]);
  });
});
