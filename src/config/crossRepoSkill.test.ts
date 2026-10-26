import { describe, expect, it } from "vitest";
import { BUILT_IN_SKILLS, BUILT_IN_SKILL_IDS } from "./skillDefinitions";

describe("the cross-repo-spec skill", () => {
  const skill = BUILT_IN_SKILLS.find((candidate) => candidate.id === BUILT_IN_SKILL_IDS.CROSS_REPO_SPEC)!;

  it("ships with the app, writes specs but never runs commands", () => {
    expect(skill.isBuiltIn).toBe(true);
    expect(skill.name).toBe("cross-repo-spec");
    expect(skill.enabledTools).toContain("write_file");
    expect(skill.enabledTools).not.toContain("run_command");
  });

  it("asks for one self-contained spec per repository, shared contracts and an overview", () => {
    const prompt = skill.systemPrompt;
    expect(prompt).toContain("stand on its own");
    expect(prompt).toContain("word for word the same in every spec");
    expect(prompt).toContain("overview.md");
    expect(prompt).toContain("never waits for or checks another repository");
    expect(prompt).toContain("No Repository: lines");
    expect(prompt).toContain("Never change code, tasks, designs");
  });
});
