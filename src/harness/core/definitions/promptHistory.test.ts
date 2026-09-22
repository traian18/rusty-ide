import { describe, expect, it } from "vitest";

import { flattenHistory } from "./promptHistory";

describe("flattenHistory", () => {
  it("returns an empty string for no history", () => {
    expect(flattenHistory([])).toBe("");
  });

  it("renders user/assistant turns with a trailing blank line", () => {
    expect(
      flattenHistory([
        { role: "user", content: "What is this repo?" },
        { role: "assistant", content: "A Tauri IDE." },
      ]),
    ).toBe("User: What is this repo?\n\nAssistant: A Tauri IDE.\n\n");
  });

  it("drops entries with an unrecognized role or missing content", () => {
    expect(
      flattenHistory([
        { role: "system", content: "ignored" },
        { role: "user" },
        "not an object",
        null,
        { role: "user", content: "kept" },
      ]),
    ).toBe("User: kept\n\n");
  });
});
