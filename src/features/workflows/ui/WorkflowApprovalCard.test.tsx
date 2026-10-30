// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowQuestion } from "../../../harness/contract";
import { WorkflowApprovalCard } from "./WorkflowApprovalCard";

const QUESTION: WorkflowQuestion = {
  requestId: "approve:1",
  step: "Plan approval",
  kind: "approval",
  prompt: "Review the plan before it is built.",
  subject: "## Plan\n1. Add the endpoint",
  decisions: [
    { id: "approve", label: "Approve", requiresText: false },
    { id: "request_changes", label: "Request changes", requiresText: true },
    { id: "reject", label: "Reject", requiresText: false },
  ],
};

describe("WorkflowApprovalCard", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const button = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
  const type = async (text: string) => {
    const notes = container.querySelector("textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(notes, text);
      notes.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("shows what is reviewed and answers with the chosen decision", async () => {
    const onAnswer = vi.fn();
    await act(async () => root.render(<WorkflowApprovalCard question={QUESTION} onAnswer={onAnswer} />));
    expect(container.textContent).toContain("Plan approval needs your answer");
    expect(container.textContent).toContain("Review the plan before it is built.");
    expect(container.textContent).toContain("Add the endpoint");
    await act(async () => button("Approve").click());
    expect(onAnswer).toHaveBeenCalledWith({ decision: "approve" });
  });

  it("asks for the changes before they can be requested, and sends them", async () => {
    const onAnswer = vi.fn();
    await act(async () => root.render(<WorkflowApprovalCard question={QUESTION} onAnswer={onAnswer} />));
    expect(button("Request changes").disabled).toBe(true);
    await type("  Split step 1 in two  ");
    expect(button("Request changes").disabled).toBe(false);
    await act(async () => button("Request changes").click());
    expect(onAnswer).toHaveBeenCalledWith({ decision: "request_changes", text: "Split step 1 in two" });
  });

  it("lays out a list subject item by item", async () => {
    const checks = [{ id: "C2", how_to_test: "Tap Share on an iPhone.", evidence: "needs a device" }];
    await act(async () => root.render(<WorkflowApprovalCard question={{ ...QUESTION, subject: checks }} onAnswer={vi.fn()} />));
    expect(container.textContent).toContain("C2");
    expect(container.textContent).toContain("Tap Share on an iPhone.");
    expect(container.textContent).not.toContain("[object Object]");
  });
});
