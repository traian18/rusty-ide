import { describe, expect, it } from "vitest";

import { DEFAULT_MIN_HEALTH, isGoalCommand, parseGoalCommand } from "./goalCommand";

describe("/goal", () => {
  it("is recognised only as the leading word", () => {
    expect(isGoalCommand("/goal tidy run.ts")).toBe(true);
    expect(isGoalCommand("  /goal")).toBe(true);
    expect(isGoalCommand("/goals")).toBe(false);
    expect(isGoalCommand("set a /goal")).toBe(false);
  });

  it("reads options before the instruction and adds attached files to the scope", () => {
    expect(parseGoalCommand('/goal scope=src/run.ts,src/run/** health=9 severity=medium checks=typecheck,test passes=5 keep=all guidelines=off done="no I/O in pure code" Split CoreRun into modules', ["src/a.ts", "src/run.ts"])).toEqual({
      kind: "start",
      instruction: "Split CoreRun into modules",
      scope: ["src/a.ts", "src/run.ts", "src/run/**"],
      targets: { minFileHealth: 9, maxSeverity: "medium", checks: ["typecheck", "test"], guidelines: false, doneWhen: "no I/O in pure code" },
      maxPasses: 5,
      keepBest: false,
    });
  });

  it("aims at healthy code when no target is given", () => {
    const command = parseGoalCommand("/goal make the parser readable");
    expect(command).toMatchObject({ kind: "start", instruction: "make the parser readable", targets: { minFileHealth: DEFAULT_MIN_HEALTH, guidelines: true }, keepBest: true });
  });

  it("has controls, and says what is wrong with a bad option", () => {
    expect(parseGoalCommand("/goal")).toEqual({ kind: "status" });
    expect(parseGoalCommand("/goal pause")).toEqual({ kind: "pause" });
    expect(parseGoalCommand("/goal resume")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("/goal clear")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("/goal health=12 x")).toMatchObject({ kind: "invalid", message: expect.stringContaining("1 to 10") });
    expect(parseGoalCommand("/goal checks=deploy x")).toMatchObject({ kind: "invalid", message: expect.stringContaining("unknown check deploy") });
    expect(parseGoalCommand("/goal colour=red x")).toMatchObject({ kind: "invalid", message: expect.stringContaining("unknown option colour") });
    expect(parseGoalCommand("/goal health=9")).toMatchObject({ kind: "invalid", message: expect.stringContaining("say what the goal is") });
  });

  it("treats words with an equals sign after the instruction starts as part of it", () => {
    expect(parseGoalCommand("/goal make x=1 the default")).toMatchObject({ instruction: "make x=1 the default" });
  });
});
