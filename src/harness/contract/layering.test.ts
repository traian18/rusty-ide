import { describe, expect, it } from "vitest";

/**
 * The harness contract (src/harness/contract/) is the one thing both
 * SidecarHarness and CoreHarness -- and any future backend -- depend on. It
 * must stay a pure type/vocabulary layer: no React, no Tauri, no the
 * composed store, no services, and critically no shared/agent-protocol
 * (that package is the *sidecar's* wire format and is owned by
 * src/harness/sidecar/ only -- see host.ts's and errors.ts's notes on this
 * boundary). A contract file that reached into any of those would make the
 * "backend-agnostic" claim false.
 *
 * Mirrors src/startup/layering.test.ts's and src/tabs/layering.test.ts's
 * import.meta.glob-based policing, including allowing `import type` (a
 * type-only import is erased at compile time -- no runtime edge -- and
 * capabilities.ts's ChatMessage vs AgentMessage split already relies on
 * that same allowance to reuse store types by name without a runtime
 * coupling).
 */

const sources: Record<string, string> = import.meta.glob("./*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const CONTRACT_FILES = Object.entries(sources).filter(([file]) => !/\.test\.tsx?$/.test(file));

function importSpecifiers(source: string, { typeOnly }: { typeOnly: boolean }): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const isTypeOnly = Boolean(match[1]);
    if (isTypeOnly === typeOnly) specifiers.push(match[2]);
  }
  return specifiers;
}

function offendersMatching(predicate: (specifier: string) => boolean): string[] {
  return CONTRACT_FILES.filter(([, source]) =>
    importSpecifiers(source, { typeOnly: false }).some(predicate),
  ).map(([file]) => file);
}

describe("harness contract layering", () => {
  it("finds the files it is meant to police", () => {
    expect(CONTRACT_FILES.length).toBeGreaterThan(0);
    expect(CONTRACT_FILES.some(([file]) => file.endsWith("harness.ts"))).toBe(true);
  });

  it("keeps React out of the contract", () => {
    expect(
      offendersMatching((s) => s === "react" || s.startsWith("react/") || s === "react-dom"),
    ).toEqual([]);
  });

  it("keeps Tauri out of the contract", () => {
    expect(offendersMatching((s) => s.startsWith("@tauri-apps/"))).toEqual([]);
  });

  it("keeps the composed store and services out of the contract at runtime", () => {
    expect(offendersMatching((s) => s.includes("../../store") || s.includes("../../services"))).toEqual([]);
  });

  it("keeps the sidecar's wire protocol out of the contract, even type-only", () => {
    // Unlike the other checks, this one is deliberately not scoped to
    // runtime imports: contract/host.ts and contract/errors.ts exist
    // specifically so the contract defines its own permission/question/
    // error vocabulary instead of even *type* importing shared/agent-
    // protocol's -- see those files' header comments.
    const allSpecifiers = CONTRACT_FILES.flatMap(
      ([, source]) => [
        ...importSpecifiers(source, { typeOnly: true }),
        ...importSpecifiers(source, { typeOnly: false }),
      ],
    );
    expect(allSpecifiers.filter((s) => s.includes("agent-protocol"))).toEqual([]);
  });
});
