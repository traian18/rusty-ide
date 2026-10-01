import { describe, expect, it } from "vitest";
import { WORKFLOW_REPORT_DIR, workflowReportFor } from "./workflowReport";

const NOW = new Date(2026, 9, 1, 17, 5, 9);
const base = { workflowName: "Research & analyze", request: "What is the best hosting for the Rusty website?", text: "# Brief\nUse GitHub Pages.", changedFiles: [], now: NOW };

describe("workflowReportFor", () => {
  it("saves what a run that changed nothing found, under .rusty/findings, named by time and topic", () => {
    const report = workflowReportFor(base)!;
    expect(report.path).toBe(`${WORKFLOW_REPORT_DIR}/2026-10-01-170509-what-is-the-best-hosting-for-the-rusty-website.md`);
    expect(report.content).toBe([
      "# What is the best hosting for the Rusty website?",
      "",
      "- Workflow: Research & analyze",
      `- Saved: ${NOW.toISOString()}`,
      "",
      "## Request",
      "",
      "What is the best hosting for the Rusty website?",
      "",
      "## Result",
      "",
      "# Brief\nUse GitHub Pages.",
      "",
    ].join("\n"));
  });

  it("saves nothing when any file was changed: the changes are the outcome", () => {
    expect(workflowReportFor({ ...base, changedFiles: ["src/a.ts"] })).toBeUndefined();
  });

  it("saves nothing when there is no real result", () => {
    for (const text of ["", "   ", "Agent complete.", "The workflow completed without output."]) {
      expect(workflowReportFor({ ...base, text })).toBeUndefined();
    }
  });

  it("keeps the title to one short line and the file name safe", () => {
    const report = workflowReportFor({ ...base, request: `Wie geht's mit Ünïcode/..\\evil?\n${"x".repeat(300)}` })!;
    expect(report.path).toMatch(/^\.rusty\/findings\/[0-9-]+-wie-geht-s-mit-unicode-evil\.md$/);
    expect(report.content.split("\n")[0]).toBe("# Wie geht's mit Ünïcode/..\\evil?");
    expect(report.path.split("/")).toHaveLength(3);
  });

  it("falls back to the workflow name when the request gives nothing to name it by", () => {
    const report = workflowReportFor({ ...base, request: "???" })!;
    expect(report.path).toMatch(/-result\.md$/);
    const blank = workflowReportFor({ ...base, request: "" })!;
    expect(blank.content.startsWith("# Research & analyze\n")).toBe(true);
    expect(blank.path).toMatch(/-research-analyze\.md$/);
    expect(blank.content).not.toContain("## Request");
  });
});
