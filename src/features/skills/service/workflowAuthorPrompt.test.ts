import { describe, expect, it } from "vitest";
import catalog from "../../workflows/starter/catalog.json";
import { WORKFLOW_AUTHOR_PROMPT } from "./workflowAuthorPrompt";

describe("Workflow Author instructions", () => {
  it("names only built-in profiles and workflows that exist", () => {
    const known = new Set([...catalog.profiles.map((profile) => profile.id), ...catalog.workflows.map((workflow) => workflow.id)]);
    const named = new Set(WORKFLOW_AUTHOR_PROMPT.match(/rusty-ide\.builtin\.[a-z-]+/g) ?? []);
    for (const id of named) expect(known.has(id), id).toBe(true);
    // The short names in the read-only / editing list are built-in profiles too.
    const list = /rusty-ide\.builtin\.: (.+?) can edit\./.exec(WORKFLOW_AUTHOR_PROMPT)?.[1] ?? "";
    for (const name of list.match(/[a-z]+/g)!.filter((word) => !["are", "and", "read", "only"].includes(word))) {
      expect(known.has(`rusty-ide.builtin.${name}`), name).toBe(true);
    }
  });

  it("tells the author to learn the engine, start from the catalog and save only through its tool", () => {
    for (const tool of ["rusty_docs", "workflow_catalog", "save_workflow"]) expect(WORKFLOW_AUTHOR_PROMPT).toContain(tool);
    expect(WORKFLOW_AUTHOR_PROMPT).toContain("You never run workflows");
  });

  it("carries the design rules, the step template and the review checklist", () => {
    for (const section of ["## How you work", "## Engine facts", "## Design rules", "## Writing a step's instructions", "## Reviewing a workflow", "## Saving", "## Reporting"]) {
      expect(WORKFLOW_AUTHOR_PROMPT).toContain(section);
    }
    // Lessons from real runs that must not be lost in an edit.
    for (const lesson of ["Never let a step judge its own work", "must not add requirements", "every file its own check touches", "allow_auto_approve false", "Propose the design before writing JSON"]) {
      expect(WORKFLOW_AUTHOR_PROMPT).toContain(lesson);
    }
  });
});
