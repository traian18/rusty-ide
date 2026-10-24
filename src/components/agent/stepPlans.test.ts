import { describe, expect, it } from "vitest";
import { mergeStepPlan } from "./stepPlans";

const todo = (content: string, status: "pending" | "completed" = "pending") => ({ content, status });

describe("mergeStepPlan", () => {
  it("keeps one list per step session, in the order the steps made them", () => {
    let plans = mergeStepPlan([], { key: "analyze:s1", name: "Analyze" }, [todo("Read")]);
    plans = mergeStepPlan(plans, { key: "spec:s2", name: "Write spec" }, [todo("Write")]);
    plans = mergeStepPlan(plans, { key: "analyze:s1", name: "Analyze" }, [todo("Read", "completed")]);
    expect(plans.map((plan) => [plan.label, plan.todos[0].status])).toEqual([["Analyze", "completed"], ["Write spec", "pending"]]);
  });

  it("numbers a step's later lists, for a retry or the next queued task", () => {
    let plans = mergeStepPlan([], { key: "build:s1", name: "Build" }, [todo("T1")]);
    plans = mergeStepPlan(plans, { key: "build:s2", name: "Build" }, [todo("T2")]);
    plans = mergeStepPlan(plans, { key: "build:s3", name: "Build" }, [todo("T3")]);
    expect(plans.map((plan) => plan.label)).toEqual(["Build", "Build (2)", "Build (3)"]);
  });
});
