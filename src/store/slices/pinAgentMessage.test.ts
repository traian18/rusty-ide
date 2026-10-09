import { describe, expect, it } from "vitest";
import { createAgentSlice } from "./createAgentSlice";

describe("setAgentMessagePinned", () => {
  it("pins and unpins one message without touching the others", () => {
    let state: any = { agentChats: { tab: [{ id: "a", role: "user", content: "x", timestamp: "" }, { id: "b", role: "assistant", content: "y", timestamp: "" }] } };
    const set = (update: any) => { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; };
    const slice = (createAgentSlice as any)(set, () => state, {});
    slice.setAgentMessagePinned("tab", "a", true);
    expect(state.agentChats.tab[0].pinned).toBe(true);
    expect(state.agentChats.tab[1]).not.toHaveProperty("pinned");
    slice.setAgentMessagePinned("tab", "a", false);
    expect(state.agentChats.tab[0]).not.toHaveProperty("pinned");
    slice.setAgentMessagePinned("missing", "a", true);
    expect(Object.keys(state.agentChats)).toEqual(["tab"]);
  });
});
