import { beforeEach, describe, expect, it } from "vitest";
import { useArchitectureView } from "./viewState";

const state = () => useArchitectureView.getState();

describe("navigation state", () => {
  beforeEach(() => state().reset());

  it("starts at the top and opens one folder after another", () => {
    expect(state().trail).toEqual([]);
    state().open({ id: "p:web", label: "web" });
    state().open({ id: "dir:web/src", label: "src" });
    expect(state().trail.map((step) => step.label)).toEqual(["web", "src"]);
  });

  it("goes back up to a depth and clears the selection and filter on every move", () => {
    state().open({ id: "p:web", label: "web" });
    state().open({ id: "dir:web/src", label: "src" });
    state().setSearch("x");
    state().goTo(1);
    expect(state().trail.map((step) => step.label)).toEqual(["web"]);
    expect(state().search).toBe("");
    state().goTo(0);
    expect(state().trail).toEqual([]);
  });

  it("ignores opening what cannot be opened", () => {
    state().open({ id: "other", label: "Other packages" });
    expect(state().trail).toEqual([]);
  });

  it("starts afresh for another repository but keeps the trail for the same one", () => {
    state().claimRoot("/a");
    state().open({ id: "p:web", label: "web" });
    state().claimRoot("/a");
    expect(state().trail).toHaveLength(1);
    state().claimRoot("/b");
    expect(state().trail).toEqual([]);
  });
});
