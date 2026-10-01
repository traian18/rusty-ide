import { describe, expect, it } from "vitest";
import {
  MAX_WORKFLOW_CONTEXT_CHARS,
  priorWorkflowContext,
  workflowInputFor,
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
