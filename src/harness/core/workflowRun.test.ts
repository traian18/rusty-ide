import { describe, expect, it } from "vitest";
import {
  MAX_FOLDED_RESULT_CHARS,
  MAX_WORKFLOW_CONTEXT_CHARS,
  conversationResults,
  describeWorkflowEvent,
  manualChecks,
  priorWorkflowContext,
  withConversation,
  workflowInputFor,
  workflowOutcome,
  workflowUsesContext,
} from "./workflowRun";

const reading = (pointer: string) => ({ nodes: [{ id: "a", input_bindings: [{ target: "x", source: { type: "run_input", pointer } }] }] });

describe("workflowUsesContext", () => {
  it("is true only when a step binds the run input's /context", () => {
    expect(workflowUsesContext(reading("/context"))).toBe(true);
    expect(workflowUsesContext(reading("/request"))).toBe(false);
    expect(workflowUsesContext({ nodes: [{ input_bindings: [{ target: "x", source: { type: "node_output", node_id: "a", pointer: "/context" } }] }] })).toBe(false);
    expect(workflowUsesContext({ nodes: [{ id: "input" }] })).toBe(false);
    expect(workflowUsesContext(null)).toBe(false);
    expect(workflowUsesContext({})).toBe(false);
  });
});

describe("priorWorkflowContext", () => {
  const message = (role: string, content: string) => ({ role, content });

  it("is the last assistant result in the chat", () => {
    expect(priorWorkflowContext([
      message("user", "investigate sync"),
      message("assistant", "first answer"),
      message("user", "and the cache?"),
      message("assistant", "  ## Findings\nThe queue.  "),
      message("user", "now design it"),
      message("console", "output"),
    ])).toBe("## Findings\nThe queue.");
  });

  it("skips bookkeeping rows and failures to reach the last real result", () => {
    expect(priorWorkflowContext([
      message("assistant", "## Brief\nUse the queue."),
      message("assistant", "**▶ Plan**"),
      message("assistant", "↳ AUTO · Light task · Haiku (90% confidence)"),
      message("assistant", "↪ AUTO · Handing over to Stage: Debug & plan a fix (86% confidence): it fits."),
      message("assistant", "**✗ Plan failed**: timeout"),
      message("assistant", "Error: timeout"),
      message("assistant", "Model selection error: no model"),
      message("assistant", "   "),
    ])).toBe("## Brief\nUse the queue.");
  });

  it("is empty when there is no earlier result", () => {
    expect(priorWorkflowContext([])).toBe("");
    expect(priorWorkflowContext([message("user", "hello")])).toBe("");
    expect(priorWorkflowContext([message("assistant", "Error: x")])).toBe("");
  });

  it("clips a very long result and says so", () => {
    const text = "a".repeat(MAX_WORKFLOW_CONTEXT_CHARS + 500);
    const context = priorWorkflowContext([message("assistant", text)]);
    expect(context.startsWith("a".repeat(MAX_WORKFLOW_CONTEXT_CHARS))).toBe(true);
    expect(context).toContain("500 more characters omitted");
    expect(context.length).toBeLessThan(text.length);
  });
});

describe("workflowInputFor", () => {
  it("wraps a message as the request, with context only when one is asked for", () => {
    expect(workflowInputFor("add reset")).toEqual({ request: "add reset", attachments: [] });
    expect(workflowInputFor("add reset", false, "earlier")).toEqual({ request: "add reset", attachments: [], context: "earlier" });
    expect(workflowInputFor("add reset", false, "")).toEqual({ request: "add reset", attachments: [], context: "" });
  });

  it("passes a JSON object message through only for a legacy JSON workflow", () => {
    expect(workflowInputFor('{"request":"x"}')).toEqual({ request: '{"request":"x"}', attachments: [] });
    expect(workflowInputFor('{"request":"x"}', true)).toEqual({ request: "x" });
    expect(workflowInputFor('{"request":"x"}', true, "earlier")).toEqual({ context: "earlier", request: "x" });
    expect(workflowInputFor("{not json", true)).toEqual({ request: "{not json", attachments: [] });
  });
});

describe("withConversation", () => {
  const chat = [
    { role: "user", content: "audit the profiles" },
    { role: "assistant", content: "**▶ Verify**" },
    { role: "assistant", content: "# Audit verdict\nThe catalog UI is missing." },
  ];

  it("returns a first message exactly as typed", () => {
    expect(withConversation("implement the profiles", [])).toBe("implement the profiles");
    expect(withConversation("implement the profiles", [{ role: "console", content: "Workflow started." }])).toBe("implement the profiles");
  });

  it("keeps the new request first and puts earlier requests and the last result behind it", () => {
    const folded = withConversation("fix the gaps", chat);
    expect(folded.startsWith("fix the gaps\n")).toBe(true);
    expect(folded).toContain("Earlier requests:\n- audit the profiles");
    expect(folded).toContain("Result of the last run:\n# Audit verdict\nThe catalog UI is missing.");
    // Run bookkeeping is not a result.
    expect(folded).not.toContain("▶ Verify");
  });

  it("uses the work a run handed over in place of the last chat result", () => {
    const folded = withConversation("fix the gaps", chat, "Handed over: the plan");
    expect(folded).toContain("Result of the last run:\nHanded over: the plan");
    expect(folded).not.toContain("Audit verdict");
  });

  it("keeps only the latest requests, each short, and a bounded result", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({ role: "user", content: `request ${index}` }));
    const folded = withConversation("now", [
      ...many,
      { role: "user", content: "x".repeat(2_000) },
      { role: "assistant", content: "y".repeat(MAX_FOLDED_RESULT_CHARS + 500) },
    ]);
    expect(folded).not.toContain("request 3");
    expect(folded).toContain("- request 6");
    expect(folded).toContain(`- ${"x".repeat(800)}…`);
    expect(folded).toContain("[… 500 more characters omitted]");
  });

  it("leaves out the note the chat adds when a result was saved as a report", () => {
    const saved = [
      { role: "assistant", content: "## Findings\nSync lives in queue.rs.\n\n_Result saved to `.rusty/findings/2026-10-01-170509-sync.md`_" },
    ];
    expect(priorWorkflowContext(saved)).toBe("## Findings\nSync lives in queue.rs.");
    expect(withConversation("next", saved)).not.toContain("Result saved to");
    expect(priorWorkflowContext([{ role: "assistant", content: "Done.\n\n_The result could not be saved to `.rusty/findings/a.md`: disk full_" }])).toBe("Done.");
    // A result that merely mentions saving keeps its text.
    expect(priorWorkflowContext([{ role: "assistant", content: "The result is saved to disk by the app." }])).toBe("The result is saved to disk by the app.");
  });

  it("does not change the larger budget a stage's context gets", () => {
    const long = "z".repeat(MAX_WORKFLOW_CONTEXT_CHARS + 10);
    expect(priorWorkflowContext([{ role: "assistant", content: long }])).toContain("[… 10 more characters omitted]");
  });
});

describe("conversationResults", () => {
  const analysis = "# Analysis\n" + "Retries live in queue.rs. ".repeat(60);

  it("is the last result when that is substantial, exactly as priorWorkflowContext gives it", () => {
    const chat = [{ role: "assistant", content: "An older result." }, { role: "assistant", content: analysis }];
    expect(conversationResults(chat)).toBe(analysis.trim());
    expect(conversationResults(chat)).toBe(priorWorkflowContext(chat));
  });

  it("is a lone short result as it is, and empty for an empty chat", () => {
    expect(conversationResults([{ role: "assistant", content: "Yes." }])).toBe("Yes.");
    expect(conversationResults([])).toBe("");
  });

  it("brings the analysis along when only a short remark came after it", () => {
    const chat = [
      { role: "user", content: "how do retries work" },
      { role: "assistant", content: "**▶ Analyze**" },
      { role: "assistant", content: analysis },
      { role: "user", content: "is jitter ok?" },
      { role: "assistant", content: "Yes, jitter is fine here." },
    ];
    const context = conversationResults(chat);
    expect(context).toBe(`Earlier result:\n${analysis.trim()}\n\nLatest reply:\nYes, jitter is fine here.`);
  });

  it("looks back at most three results and keeps within the budget, favouring the latest remark", () => {
    const chat = ["one", "two", "three", "four"].map((content) => ({ role: "assistant", content }));
    const context = conversationResults(chat);
    expect(context).not.toContain("one");
    expect(context).toContain("Latest reply:\nfour");
    const big = [{ role: "assistant", content: "z".repeat(5_000) }, { role: "assistant", content: "ok" }];
    expect(conversationResults(big, 1_000).length).toBeLessThan(1_100);
    expect(conversationResults(big, 1_000)).toContain("Latest reply:\nok");
  });

  it("ignores run bookkeeping and the saved-report note", () => {
    const chat = [
      { role: "assistant", content: `${analysis}\n\n_Result saved to \`.rusty/findings/x.md\`_` },
      { role: "assistant", content: "Error: network down" },
      { role: "assistant", content: "**▶ Build**" },
    ];
    expect(conversationResults(chat)).toBe(analysis.trim());
  });
});

describe("manual checks", () => {
  const gateOutput = (checks: unknown[]) => ({ passed: true, checks: [], issues: [], manual_checks: checks });
  const state = {
    status: "completed",
    final_output: "Done.",
    steps: {
      gate: { output: gateOutput([{ id: "C2", how_to_test: "Tap Share on iOS.", evidence: "needs a phone" }]) },
      review_gate: { output: gateOutput([{ id: "C2", how_to_test: "Tap Share on iOS." }, { id: "R1", how_to_test: "" }]) },
      verify: { output: { summary: "fine" } },
    },
  };

  it("collects what every gate left for the user, once each", () => {
    expect(manualChecks(state)).toEqual([
      { id: "C2", howToTest: "Tap Share on iOS." },
      { id: "R1", howToTest: "" },
    ]);
    expect(manualChecks({ steps: { verify: { output: "text" } } })).toEqual([]);
  });

  it("lists them after the result of a completed run", () => {
    expect(workflowOutcome(state)).toEqual({
      status: "completed",
      output: "Done.\n\n## Manual checks for you\nThese could not be checked here. Please check them by hand:\n- **C2**: Tap Share on iOS.\n- **R1**: Check this by hand.",
    });
    expect(workflowOutcome({ ...state, steps: {} })).toEqual({ status: "completed", output: "Done." });
  });
});

describe("questions to the user", () => {
  const names = { approve: "Plan approval" };
  it("shows the step as waiting for an answer, then says how it was answered", () => {
    expect(describeWorkflowEvent({ event: { type: "input_requested", node_id: "approve", attempt: 1 } }, names)).toEqual({
      log: "Plan approval is waiting for your answer.",
      step: { nodeId: "approve", status: "asking", attempt: 1 },
    });
    expect(describeWorkflowEvent({ event: { type: "input_resolved", node_id: "approve", attempt: 1, response: { decision: "request_changes", by: "user" } } }, names).log)
      .toBe("Plan approval: you chose request changes.");
    expect(describeWorkflowEvent({ event: { type: "input_resolved", node_id: "approve", attempt: 1, response: { decision: "approve", by: "auto" } } }, names).log)
      .toBe("Plan approval: answered automatically (approve).");
  });
});
