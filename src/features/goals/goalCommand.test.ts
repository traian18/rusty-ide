import { describe, expect, it } from "vitest";

import { isGoalCommand, parseGoalCommand } from "./goalCommand";

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

  it("is a task goal, with no code health target, when none is given", () => {
    const command = parseGoalCommand("/goal add CSV export to the report page");
    expect(command).toMatchObject({ kind: "start", instruction: "add CSV export to the report page", targets: { checks: [], guidelines: true }, keepBest: true });
    expect(command.kind === "start" && command.targets.minFileHealth).toBeUndefined();
  });

  it("reads a quoted scope with spaces as words, and a path list otherwise", () => {
    expect(parseGoalCommand('/goal scope="the task queue and what schedules it" health=8 make it fast')).toMatchObject({ scope: [], scopeNote: "the task queue and what schedules it", instruction: "make it fast" });
    expect(parseGoalCommand('/goal scope="rusty-core" tidy')).toMatchObject({ scope: ["rusty-core"], instruction: "tidy" });
    expect(parseGoalCommand("/goal scope=The general health is 8.2")).toMatchObject({ scope: ["The"], instruction: "general health is 8.2" });
  });

  it("takes a mean target for general health, which counts as a target", () => {
    expect(parseGoalCommand("/goal mean=8.5 health=6 raise rusty-core")).toMatchObject({ instruction: "raise rusty-core", targets: { minMeanHealth: 8.5, minFileHealth: 6 } });
    const mean = parseGoalCommand("/goal mean=8 raise it");
    expect(mean).toMatchObject({ targets: { minMeanHealth: 8 } });
    expect(mean.kind === "start" && mean.targets.minFileHealth).toBeUndefined();
    expect(parseGoalCommand("/goal mean=11 x")).toMatchObject({ kind: "invalid", message: expect.stringContaining("1 to 10") });
  });

  it("takes a number of loops, and has no pass limit without one", () => {
    expect(parseGoalCommand("/goal loops=12 add CSV export")).toMatchObject({ maxPasses: 12, instruction: "add CSV export" });
    expect(parseGoalCommand("/goal passes=3 add CSV export")).toMatchObject({ maxPasses: 3 });
    const unlimited = parseGoalCommand("/goal add CSV export");
    expect(unlimited.kind === "start" && unlimited.maxPasses).toBeUndefined();
    expect(parseGoalCommand("/goal loops=0 x")).toMatchObject({ kind: "invalid", message: "loops must be a whole number from 1 to 100." });
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
