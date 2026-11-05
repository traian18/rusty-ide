// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

/**
 * Runs FileTab on the real wrapper and the real Monaco: what is under test is
 * how they treat a model that outlives its editor, which a stub would assume.
 */

const mocks = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  /** While set, a read has what it found but has not returned it yet. */
  readGate: null as Promise<void> | null,
  invoke: vi.fn(),
  loadGitStatus: vi.fn(),
  fsListeners: new Set<() => void>(),
  state: {} as Record<string, unknown>,
}));

vi.mock("../../../store", () => {
  const useWorkspaceStore = (selector: (state: unknown) => unknown) => selector(mocks.state);
  useWorkspaceStore.getState = () => mocks.state;
  return { useWorkspaceStore };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, listener: () => void) => {
    mocks.fsListeners.add(listener);
    return () => mocks.fsListeners.delete(listener);
  },
}));
vi.mock("../../../theme", () => ({ themes: { dark: {} }, defineMonacoTheme: vi.fn() }));
vi.mock("../service/monacoDiagnostics", () => ({ disableBuiltInTsDiagnostics: vi.fn() }));
vi.mock("../../canvas/service/vfs", () => ({
  VFS_CHANGED_EVENT: "rusty-vfs-changed",
  VfsRegistry: {
    getOrCreate: () => ({
      readFile: async (path: string) => {
        const text = mocks.disk.get(path);
        await mocks.readGate;
        return text;
      },
      writeFile: async (path: string, text: string) => void mocks.disk.set(path, text),
    }),
  },
}));
vi.mock("../monacoOptions", () => ({
  // The minimap only paints, on a canvas jsdom does not have.
  createMonacoEditorOptions: (_fontSize: number, options: object) => ({ ...options, minimap: { enabled: false } }),
}));
vi.mock("../../../lib/ui/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));
vi.mock("./InlineChat", () => ({ InlineChat: () => null }));
vi.mock("../../git/ui", () => ({ CompareRevisionPicker: () => null }));

import { FileTab } from "./FileTab";

type FileTabTab = React.ComponentProps<typeof FileTab>["tab"];

const PATH = "/workspace/src/main.ts";
const TAB: FileTabTab = { id: "file-1", type: "file", title: "main.ts", status: "idle", dirty: false, path: PATH };
const COPY: FileTabTab = { ...TAB, id: "copy-1" };
const SAVE_DELAY_MS = 500;
const RELOAD_DELAY_MS = 250;

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const writes = () => mocks.invoke.mock.calls.filter(([command]) => command === "write_file_disk");
const editors = () => monaco.editor.getEditors();
const model = () => monaco.editor.getModel(monaco.Uri.parse(`file://${PATH}`))!;

let container: HTMLDivElement;
let root: Root;

async function show(...tabs: FileTabTab[]) {
  act(() => root.render(<>{tabs.map((tab) => <FileTab key={tab.id} tab={tab} isActive={true} />)}</>));
  await vi.waitFor(() => expect(editors()).toHaveLength(tabs.length));
  await wait(0);
}

/** The tab stays open but leaves the screen, as switching to another tab does. */
const hide = () => act(() => root.render(<></>));

/** What the terminal, git or an agent writing the file looks like from here. */
async function changeOnDisk(text: string) {
  mocks.disk.set(PATH, text);
  act(() => mocks.fsListeners.forEach((listener) => listener()));
  await wait(RELOAD_DELAY_MS + 20);
}

function typeAt(editor: ReturnType<typeof editors>[number], lineNumber: number, column: number, text: string) {
  act(() => {
    editor.setPosition({ lineNumber, column });
    editor.trigger("keyboard", "type", { text });
  });
}

describe("FileTab and the file on disk", () => {
  beforeAll(() => {
    // jsdom has no layout or canvas, which Monaco reads but does not need here.
    Object.assign(document, { queryCommandSupported: () => false });
    HTMLCanvasElement.prototype.getContext = (() =>
      new Proxy({}, {
        get: (_target, key) => {
          if (String(key).endsWith("PixelRatio")) return undefined;
          return () => ({ width: 8, data: new Uint8ClampedArray(4) });
        },
        set: () => true,
      })) as never;
    loader.config({ monaco });
  });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("monaco", monaco);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.invoke.mockReset();
    mocks.fsListeners.clear();
    mocks.disk.clear();
    mocks.readGate = null;
    mocks.disk.set(PATH, "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    Object.assign(mocks.state, {
      typographyPreferences: { editorFontSize: 14 },
      rootPath: "/workspace",
      repositories: [],
      canvasContexts: {},
      editorFileSafety: { largeFileThresholdBytes: 1_000_000 },
      tabs: [TAB],
      openTab: vi.fn(),
      revealFileInTree: vi.fn(),
      loadGitStatus: mocks.loadGitStatus,
      activeThemeId: "dark",
      activeTabId: TAB.id,
    });
    mocks.invoke.mockImplementation(async (command: string, args: { path: string; content: string }) => {
      if (command === "check_file_open_safety") return { kind: "safe", size_bytes: 0 };
      if (command === "git_blame") return [];
      if (command === "git_get_head_content") return "";
      if (command === "write_file_disk") mocks.disk.set(args.path, args.content);
      return undefined;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    mocks.state.tabs = [];
    act(() => root.unmount());
    await wait(1);
    monaco.editor.getModels().forEach((openModel) => openModel.dispose());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows what changed on disk while the tab was hidden, and saves on top of it", async () => {
    await show(TAB);
    hide();

    mocks.disk.set(PATH, "const fromAgent = true;\n");
    await show(TAB);

    expect(editors()[0].getValue()).toBe("const fromAgent = true;\n");

    typeAt(editors()[0], 2, 1, "// typed\n");
    await wait(SAVE_DELAY_MS + 20);

    expect(mocks.disk.get(PATH)).toBe("const fromAgent = true;\n// typed\n");
  });

  it("follows the file while the tab stays on screen, without writing it back", async () => {
    await show(TAB);

    await changeOnDisk("const fromTerminal = true;\n");

    expect(editors()[0].getValue()).toBe("const fromTerminal = true;\n");
    await wait(SAVE_DELAY_MS + 20);
    expect(writes()).toHaveLength(0);
  });

  it("updates both side-by-side tabs of the file without writing it back", async () => {
    mocks.state.tabs = [TAB, COPY];
    await show(TAB, COPY);

    await changeOnDisk("const fromGit = true;\n");

    expect(editors().map((editor) => editor.getValue())).toEqual(["const fromGit = true;\n", "const fromGit = true;\n"]);
    await wait(SAVE_DELAY_MS + 20);
    expect(writes()).toHaveLength(0);
  });

  it("lets a pending save win over a reload", async () => {
    await show(TAB);
    typeAt(editors()[0], 1, 1, "// typed\n");

    await changeOnDisk("const fromAgent = true;\n");

    expect(editors()[0].getValue()).toContain("// typed\n");
    await wait(SAVE_DELAY_MS + 20);
    expect(mocks.disk.get(PATH)).toBe("// typed\nconst a = 1;\nconst b = 2;\nconst c = 3;\n");
  });

  it("keeps typing whose write is still on its way to the disk", async () => {
    await show(TAB);
    let finishWrite = () => {};
    mocks.invoke.mockImplementation((command: string, args: { path: string; content: string }) => {
      if (command === "check_file_open_safety") return Promise.resolve({ kind: "safe", size_bytes: 0 });
      if (command !== "write_file_disk") return Promise.resolve(undefined);
      return new Promise<void>((resolve) => {
        finishWrite = () => {
          mocks.disk.set(args.path, args.content);
          resolve();
        };
      });
    });
    typeAt(editors()[0], 1, 1, "// typed\n");
    await wait(SAVE_DELAY_MS + 20);

    await changeOnDisk(mocks.disk.get(PATH)!);

    expect(editors()[0].getValue()).toContain("// typed\n");
    await act(async () => finishWrite());
  });

  it("keeps typing whose write failed, until the next edit retries it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await show(TAB);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "write_file_disk") throw new Error("disk full");
      return { kind: "safe", size_bytes: 0 };
    });
    typeAt(editors()[0], 1, 1, "// typed\n");
    await wait(SAVE_DELAY_MS + 20);

    await changeOnDisk(mocks.disk.get(PATH)!);

    expect(editors()[0].getValue()).toContain("// typed\n");
  });

  it("still saves typing when the tab is hidden before the save runs", async () => {
    await show(TAB);
    typeAt(editors()[0], 1, 1, "// typed\n");

    hide();
    await wait(SAVE_DELAY_MS + 20);

    expect(mocks.disk.get(PATH)).toBe("// typed\nconst a = 1;\nconst b = 2;\nconst c = 3;\n");
    await show(TAB);
    expect(editors()[0].getValue()).toContain("// typed\n");
  });

  it("returns to typing that is still waiting to be saved, over the older file", async () => {
    await show(TAB);
    typeAt(editors()[0], 1, 1, "// typed\n");

    hide();
    await show(TAB);

    expect(editors()[0].getValue()).toContain("// typed\n");
  });

  it("leaves the cursor where it was and the change undoable", async () => {
    await show(TAB);
    const [editor] = editors();
    act(() => editor.setPosition({ lineNumber: 3, column: 7 }));

    await changeOnDisk("const a = 100;\nconst b = 2;\nconst c = 3;\n");

    expect(editor.getPosition()).toMatchObject({ lineNumber: 3, column: 7 });
    act(() => editor.trigger("keyboard", "undo", null));
    expect(editor.getValue()).toBe("const a = 1;\nconst b = 2;\nconst c = 3;\n");
  });

  it("leaves a file with mixed line endings alone when nothing changed", async () => {
    mocks.disk.set(PATH, "one\r\ntwo\nthree\r\n");
    await show(TAB);
    const versionBefore = model().getVersionId();

    await changeOnDisk(mocks.disk.get(PATH)!);

    expect(model().getVersionId()).toBe(versionBefore);
    await wait(SAVE_DELAY_MS + 20);
    expect(writes()).toHaveLength(0);
  });

  it("keeps a character outside the basic plane whole when only half of it changed", async () => {
    mocks.disk.set(PATH, "before \u{1F600} after\n");
    await show(TAB);
    const [editor] = editors();

    await changeOnDisk("before \u{10600} after\n");

    expect(editor.getValue()).toBe("before \u{10600} after\n");
    act(() => editor.trigger("keyboard", "undo", null));
    expect(editor.getValue()).toBe("before \u{1F600} after\n");
  });

  it("drops a read that typing overtook, even once that typing has been saved", async () => {
    await show(TAB);
    let finishRead = () => {};
    mocks.readGate = new Promise((resolve) => (finishRead = resolve));
    await changeOnDisk(mocks.disk.get(PATH)!);

    typeAt(editors()[0], 1, 1, "// typed\n");
    await wait(SAVE_DELAY_MS + 20);
    await act(async () => finishRead());

    expect(editors()[0].getValue()).toContain("// typed\n");
  });

  it("lets a pending save win over a change in a canvas's VFS", async () => {
    const CANVAS_FILE: FileTabTab = { ...TAB, vfsTabId: "canvas-1" };
    mocks.state.tabs = [CANVAS_FILE];
    await show(CANVAS_FILE);
    typeAt(editors()[0], 1, 1, "// typed\n");

    mocks.disk.set(PATH, "const fromCanvas = true;\n");
    act(() => {
      window.dispatchEvent(new CustomEvent("rusty-vfs-changed", { detail: { tabId: "canvas-1", paths: [PATH] } }));
    });
    await wait(1);

    expect(editors()[0].getValue()).toContain("// typed\n");
    await wait(SAVE_DELAY_MS + 20);
  });

  it("keeps the last text when the file disappears", async () => {
    await show(TAB);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    mocks.disk.delete(PATH);
    act(() => mocks.fsListeners.forEach((listener) => listener()));
    await wait(RELOAD_DELAY_MS + 20);

    expect(editors()[0].getValue()).toContain("const a = 1;");
  });

  it("updates the Markdown preview of a tab whose editor is not on screen", async () => {
    const README: FileTabTab = { ...TAB, id: "readme", path: "/workspace/README.md", title: "README.md" };
    mocks.state.tabs = [README];
    mocks.disk.set(README.path, "# Old\n");
    act(() => root.render(<FileTab key={README.id} tab={README} isActive={true} />));
    await wait(0);
    await vi.waitFor(() => expect(container.querySelector('[data-testid="markdown"]')?.textContent).toBe("# Old\n"));

    mocks.disk.set(README.path, "# New\n");
    act(() => mocks.fsListeners.forEach((listener) => listener()));
    await wait(RELOAD_DELAY_MS + 20);

    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toBe("# New\n");
  });
});
