import { beforeEach, describe, expect, it } from "vitest";

import { OVERVIEW_PAGE, useDocsView } from "./docsState";

const state = () => useDocsView.getState();

describe("docs view state", () => {
  beforeEach(() => state().reset());

  it("keeps the open page for its repository and starts another at the overview", () => {
    state().claimRoot("/a");
    state().selectGuide("folder:dir:src");
    state().claimRoot("/a");
    expect(state().guidePage).toBe("folder:dir:src");
    state().claimRoot("/b");
    expect(state().guidePage).toBe(OVERVIEW_PAGE);
  });
});
