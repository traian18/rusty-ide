import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { RunHost } from "../../contract";
import { PROJECT_INFO_TOOL, projectInfoTool } from "./projectInfoTool";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const signal = new AbortController().signal;

const file = (name: string) => ({ name, path: `/ws/${name}`, is_dir: false });
const dir = (name: string, children: unknown[]) => ({ name, path: `/ws/${name}`, is_dir: true, children });

/** A workspace of two projects: a Tauri app in `ide` and a Go service in `svc`. */
const TREE: Record<string, string> = {
  "ide/package.json": JSON.stringify({ scripts: { test: "vitest run", tauri: "tauri" }, dependencies: { react: "18" } }),
  "ide/package-lock.json": "{}",
  "ide/src-tauri/Cargo.toml": '[package]\nname = "ide"\n',
  "ide/src-tauri/tauri.conf.json": "{}",
  "svc/go.mod": "module example.com/svc\n\ngo 1.22\n",
};

const LISTING = {
  entries: [
    dir("ide", [file("package.json"), file("package-lock.json"), dir("src-tauri", [file("Cargo.toml"), file("tauri.conf.json")])]),
    dir("svc", [file("go.mod")]),
  ],
  truncated: false,
};

function fakeHost(overrides: Partial<RunHost> = {}): RunHost {
  return {
    readFile: vi.fn(async (path: string) => {
      const relative = path.replace(/^\/ws\//, "");
      if (!(relative in TREE)) throw new Error(`File not found: ${path}`);
      return TREE[relative];
    }),
    writeFile: vi.fn(),
    requestPermission: vi.fn(),
    ...overrides,
  } as unknown as RunHost;
}

function answer(listing: unknown = LISTING, existing: string[] = ["/ws/ide/node_modules"]) {
  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "list_directory") return listing;
    if (command === "check_external_path") return { exists: existing.includes((args as { path: string }).path) };
    throw new Error(`unexpected command ${command}`);
  });
}

describe("projectInfoTool", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("scans the workspace through the bounded command and reads manifests through the host", async () => {
    answer();
    const host = fakeHost();
    const outcome = await projectInfoTool("/ws", host)(undefined, signal);

    expect(invokeMock).toHaveBeenCalledWith("list_directory", { path: "/ws", depth: 4 });
    expect(host.readFile).toHaveBeenCalledWith("/ws/ide/package.json", signal);
    expect(host.readFile).toHaveBeenCalledWith("/ws/svc/go.mod", signal);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output).toContain("2 projects found.");
    expect(outcome.output).toContain("- test: npm run test   cwd: ide");
    expect(outcome.output).toContain("- typecheck: cargo check   cwd: ide/src-tauri");
    expect(outcome.output).toContain("- test: go test ./...   cwd: svc");
  });

  it("checks for node_modules with the existence command, since the scan skips it", async () => {
    answer(LISTING, ["/ws/ide/node_modules"]);
    const present = await projectInfoTool("/ws", fakeHost())(undefined, signal);
    if (!present.ok) throw new Error("expected ok");
    expect(invokeMock).toHaveBeenCalledWith("check_external_path", { path: "/ws/ide/node_modules" });
    expect(present.output).toContain("dependencies are installed");

    answer(LISTING, []);
    const absent = await projectInfoTool("/ws", fakeHost())(undefined, signal);
    if (!absent.ok) throw new Error("expected ok");
    expect(absent.output).toContain("dependencies are NOT installed");
    expect(absent.output).toContain("- install: npm ci   cwd: ide");
  });

  it("treats a failing existence check as not present rather than failing the tool", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_directory") return LISTING;
      throw new Error("denied");
    });
    const outcome = await projectInfoTool("/ws", fakeHost())(undefined, signal);
    expect(outcome.ok).toBe(true);
  });

  it("focuses on one project when given a path, including a folder inside it", async () => {
    answer();
    const direct = await projectInfoTool("/ws", fakeHost())({ path: "svc" }, signal);
    if (!direct.ok) throw new Error("expected ok");
    expect(direct.output).toContain("1 project found.");
    expect(direct.output).toContain("go test");
    expect(direct.output).not.toContain("npm run test");

    const inside = await projectInfoTool("/ws", fakeHost())({ path: "ide/src-tauri/src" }, signal);
    if (!inside.ok) throw new Error("expected ok");
    expect(inside.output).toContain("npm run test");
  });

  it("says so, without erroring, when no project is at the path", async () => {
    answer();
    expect(await projectInfoTool("/ws", fakeHost())({ path: "nowhere" }, signal)).toEqual({
      ok: true,
      output: "No project found at or above 'nowhere'. Call project_info without path to see every project in the workspace.",
    });
  });

  it("reports a workspace with nothing recognizable and an oversized scan", async () => {
    answer({ entries: [file("notes.txt")], truncated: true });
    const outcome = await projectInfoTool("/ws", fakeHost())(undefined, signal);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output).toContain("No recognizable project was found");
    expect(outcome.output).toContain("too large to scan completely");
  });

  it("copes with a manifest the host cannot read", async () => {
    answer();
    const host = fakeHost({ readFile: vi.fn().mockRejectedValue(new Error("denied")) });
    const outcome = await projectInfoTool("/ws", host)(undefined, signal);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output).toContain("node (npm)");
  });

  it("fails clearly when the directory cannot be listed or no workspace is open", async () => {
    invokeMock.mockRejectedValue("Directory does not exist");
    expect(await projectInfoTool("/ws", fakeHost())(undefined, signal)).toEqual({ ok: false, error: "Directory does not exist" });
    expect(await projectInfoTool("  ", fakeHost())(undefined, signal)).toEqual({ ok: false, error: expect.stringContaining("No workspace is open") });
  });

  it("advertises one optional path argument and tells models to call it before building", () => {
    expect(PROJECT_INFO_TOOL.name).toBe("project_info");
    expect(Object.keys(PROJECT_INFO_TOOL.input_schema.properties as object)).toEqual(["path"]);
    expect(PROJECT_INFO_TOOL.input_schema.required).toEqual([]);
    expect(PROJECT_INFO_TOOL.description).toMatch(/Call it before running any build, test or verification/);
  });
});
