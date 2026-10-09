import { describe, expect, it, vi } from "vitest";
import { flattenHistory } from "../harness/core/definitions/promptHistory";
import {
  KEEP_RECENT_TURNS,
  historyTurnsOf,
  judgeTurns,
  readHistorySummary,
  refreshHistorySummary,
  summaryCandidates,
  type HistorySummary,
  type HistoryTurn,
} from "./historySummary";
import type { CustomProvider } from "../store/types";

vi.mock("../harness/HybridControlPlane", () => ({ hybridControlPlane: { recordUsage: vi.fn(() => Promise.resolve()) } }));

const turn = (id: string, role: "user" | "assistant", content: string, pinned = false): HistoryTurn => ({ id, role, content, ...(pinned ? { pinned } : {}) });

/** 14 turns of ~100 chars: the opening request, then alternating replies and follow-ups. */
function longChat(): HistoryTurn[] {
  return Array.from({ length: 14 }, (_, index) =>
    turn(`t${index}`, index % 2 === 0 ? "user" : "assistant", `${index === 0 ? "OPENING" : `turn ${index}`} ${"x".repeat(90)}`, index === 3));
}

const jevAnswer = (levels: number[]) => ({
  ok: true,
  status: 200,
  text: "",
  result: { answers: Object.fromEntries(levels.map((level, index) => [`m${index}`, {
    confidence: 0.9,
    probabilities: { "0": level === 0 ? 0.8 : 0.1, "1": level === 1 ? 0.8 : 0.1, "2": level === 2 ? 0.8 : 0.1 },
  }])) },
});

const provider = { id: "p", name: "P", models: [] } as unknown as CustomProvider;

describe("summaryCandidates", () => {
  it("does nothing while the history is within the soft limit", () => {
    expect(summaryCandidates(longChat(), undefined, 100_000)).toBeUndefined();
  });

  it("skips the opening request, pinned turns, the newest turns and what is already handled", () => {
    const turns = longChat();
    const previous: HistorySummary = { text: "s", summarizedIds: ["t1"], droppedIds: ["t2"], essentialIds: ["t4"], updatedAt: "" };
    const ids = summaryCandidates(turns, previous, 500)!.map((candidate) => candidate.id);
    expect(ids).toEqual(["t5", "t6", "t7"]);
    expect(ids).not.toContain(turns[turns.length - KEEP_RECENT_TURNS]!.id);
  });
});

describe("judgeTurns", () => {
  it("maps JEV's scores and steps an unsure rating towards keeping", async () => {
    const post = vi.fn(async () => ({
      ok: true, status: 200, text: "",
      result: { answers: {
        m0: { confidence: 0.9, probabilities: { "0": 0.9, "1": 0.05, "2": 0.05 } },
        m1: { confidence: 0.3, probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 } },
      } },
    }));
    const verdicts = await judgeTurns({ apiKey: "k", jevModelId: "jev" }, "task", [turn("a", "user", "keep"), turn("b", "assistant", "unsure")], new AbortController().signal, post as never);
    expect(verdicts.get("a")).toBe("essential");
    expect(verdicts.get("b")).toBe("useful");
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("refreshHistorySummary", () => {
  const base = { budgetChars: 500, provider, model: "p/m", jev: { apiKey: "k", jevModelId: "jev" }, workspaceRoot: "/w", tabId: "tab", signal: new AbortController().signal, recordUsage: vi.fn() };

  it("keeps essential turns, drops disposable ones and summarizes the rest", async () => {
    const turns = longChat();
    const invoker = { invoke: vi.fn(async () => "- summary") };
    // Candidates t1, t2, t4..t7 (t3 is pinned): t1 essential, t2 disposable, the rest useful.
    const post = vi.fn(async () => jevAnswer([0, 2, 1, 1, 1, 1]));
    const next = await refreshHistorySummary({ ...base, turns, previous: undefined, invoker, post: post as never });
    expect(next).toMatchObject({ text: "- summary", essentialIds: ["t1"], droppedIds: ["t2"], summarizedIds: ["t4", "t5", "t6", "t7"] });

    const prompt = flattenHistory(turns, { summary: next });
    expect(prompt).toContain("OPENING");
    expect(prompt).toContain("turn 1 ");
    expect(prompt).not.toContain("turn 2 ");
    expect(prompt).toContain("turn 3 "); // pinned
    expect(prompt).not.toContain("turn 5 ");
    expect(prompt).toContain("Summary of earlier conversation:\n- summary");
    expect(prompt.indexOf("Summary of earlier")).toBeLessThan(prompt.indexOf("turn 8 "));
  });

  it("keeps the previous summary when the summarizer fails, and works without JEV verdicts", async () => {
    const invoker = { invoke: vi.fn(async () => { throw new Error("down"); }) };
    const post = vi.fn(async () => { throw new Error("jev down"); });
    const next = await refreshHistorySummary({ ...base, turns: longChat(), previous: undefined, invoker, post: post as never });
    expect(next).toBeUndefined();
    expect(invoker.invoke).toHaveBeenCalledTimes(1);
  });

  it("folds new turns into the previous summary", async () => {
    const invoker = { invoke: vi.fn(async (_request: { userPrompt: string }) => "- merged") };
    const previous: HistorySummary = { text: "- old", summarizedIds: ["t1", "t2"], droppedIds: [], essentialIds: [], updatedAt: "" };
    const next = await refreshHistorySummary({ ...base, turns: longChat(), previous, invoker, post: vi.fn(async () => jevAnswer([1, 1, 1, 1])) as never });
    expect(invoker.invoke.mock.calls[0]![0].userPrompt).toContain("Previous summary:\n- old");
    expect(next!.summarizedIds).toEqual(["t1", "t2", "t4", "t5", "t6", "t7"]);
  });
});

describe("historyTurnsOf / readHistorySummary", () => {
  it("carries pins and attached context, and ignores console messages", () => {
    const turns = historyTurnsOf([
      { id: "1", role: "user", content: "q", attachmentContext: "ctx", timestamp: "", pinned: true },
      { id: "2", role: "console", content: "log", timestamp: "" },
      { id: "3", role: "assistant", content: "a", timestamp: "" },
    ]);
    expect(turns).toEqual([{ id: "1", role: "user", content: "q\n\nctx", pinned: true }, { id: "3", role: "assistant", content: "a" }]);
  });

  it("reads saved summaries defensively", () => {
    expect(readHistorySummary(undefined)).toBeUndefined();
    expect(readHistorySummary({ summarizedIds: [] })).toBeUndefined();
    expect(readHistorySummary({ text: "s", summarizedIds: ["a", 3], droppedIds: null })).toEqual({ text: "s", summarizedIds: ["a"], droppedIds: [], essentialIds: [], updatedAt: "" });
  });
});
