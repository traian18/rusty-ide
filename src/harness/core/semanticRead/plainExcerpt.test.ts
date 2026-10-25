import { describe, expect, it } from "vitest";
import { plainExcerpt, requestTerms } from "./plainExcerpt";

const FILE = Array.from({ length: 1000 }, (_, index) => (index === 500 ? "export function sessionRuntime() {" : `const filler${index} = ${index};`)).join("\n");

describe("plainExcerpt", () => {
  it("keeps the identifiers and longer words of a request", () => {
    expect(requestTerms("Read the session runtime fields and start_command behavior")).toEqual(["session", "runtime", "fields", "start_command", "behavior"]);
  });

  it("returns the lines around a line that names a word of the request", () => {
    const output = plainExcerpt("a.ts", FILE, "where is sessionRuntime defined");
    expect(output).toContain("File: a.ts (1000 lines)");
    expect(output).toContain("[lines 493-509]");
    expect(output).toContain("export function sessionRuntime() {");
    expect(output).not.toContain("filler10 ");
  });

  it("returns the first lines when the request names nothing in the file", () => {
    const output = plainExcerpt("a.ts", FILE, "the parser");
    expect(output).toContain("[lines 1-300]");
  });

  it("stops at its line budget however many lines match", () => {
    const output = plainExcerpt("a.ts", FILE, "filler");
    expect(output.split("\n").length).toBeLessThanOrEqual(305);
  });
});
