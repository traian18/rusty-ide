// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  searchProject: vi.fn(),
  openTab: vi.fn(),
  loadGitStatus: vi.fn(),
  revealFileInTree: vi.fn(),
  editorProps: [] as any[],
  state: {} as Record<string, unknown>,
}));

vi.mock("../../../store", () => {
  const useWorkspaceStore = (selector: (state: unknown) => unknown) => selector(mocks.state);
  useWorkspaceStore.getState = () => mocks.state;
  return { useWorkspaceStore };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@monaco-editor/react", () => ({
  default: (props: any) => {
    mocks.editorProps.push(props);
    return <div data-testid="editor">{props.value}</div>;
  },
  // Theme setup is not under test.
  loader: { init: () => new Promise(() => {}) },
}));
vi.mock("../../../theme", () => ({ themes: { dark: {} }, defineMonacoTheme: vi.fn() }));
vi.mock("../service/monacoDiagnostics", () => ({ disableBuiltInTsDiagnostics: vi.fn() }));
vi.mock("../../canvas/service/vfs", () => ({
  VFS_CHANGED_EVENT: "rusty-vfs-changed",
  VfsRegistry: { getOrCreate: () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile }) },
}));
vi.mock("../../explorer/service/searchService", () => ({ searchService: { searchProject: mocks.searchProject } }));
vi.mock("../monacoOptions", () => ({
  createMonacoEditorOptions: (_fontSize: number, options: unknown) => options,
}));
vi.mock("../../../lib/ui/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));
vi.mock("./InlineChat", () => ({ InlineChat: () => <div data-testid="inline-chat" /> }));
vi.mock("../../git/ui", () => ({ CompareRevisionPicker: () => null }));
vi.mock("./UnsupportedFilePreview", () => ({
  UnsupportedFilePreview: ({ sizeBytes }: { sizeBytes: number }) => <div data-testid="unsupported" data-size={sizeBytes} />,
  formatFileSize: (bytes: number) => `${bytes} B`,
}));
vi.mock("./ImageFilePreview", () => ({
  ImageFilePreview: ({ src, sizeBytes }: { src: string; sizeBytes: number }) => (
    <div data-testid="image-preview" data-src={src} data-size={sizeBytes} />
  ),
}));

import { FileTab } from "./FileTab";

type FileTabTab = React.ComponentProps<typeof FileTab>["tab"];

const TS_FILE: FileTabTab = { id: "file-1", type: "file", title: "main.ts", status: "idle", dirty: false, path: "/workspace/src/main.ts" };

let container: HTMLDivElement;
let root: Root;
let commands: Record<string, unknown>;

const editorProps = () => mocks.editorProps[mocks.editorProps.length - 1];
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const buttonTitled = (title: string) => container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
const buttonNamed = (text: string) => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text));

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function renderTab(tab: FileTabTab) {
  act(() => root.render(<FileTab tab={tab} isActive={true} />));
  await flush();
}

function fakeEditor() {
  const editor = {
    mouseDown: undefined as undefined | ((event: unknown) => Promise<void>),
    addAction: vi.fn(() => ({ dispose: vi.fn() })),
    onMouseDown: vi.fn((handler: (event: unknown) => Promise<void>) => { editor.mouseDown = handler; }),
    getModel: () => ({ getWordAtPosition: () => ({ word: "loadUser" }) }),
    getDomNode: () => null,
    getScrolledVisiblePosition: () => null,
    createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
    layout: vi.fn(),
    revealLineInCenter: vi.fn(),
    setPosition: vi.fn(),
    focus: vi.fn(),
  };
  return editor;
}

async function mountEditor() {
  const editor = fakeEditor();
  act(() => editorProps().onMount(editor, { KeyMod: { CtrlCmd: 2048 }, KeyCode: { Enter: 3 } }));
  return editor;
}

describe("FileTab", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    mocks.editorProps.length = 0;
    Object.assign(mocks.state, {
      typographyPreferences: { editorFontSize: 14 },
      rootPath: "/workspace",
      repositories: [],
      canvasContexts: {},
      editorFileSafety: { largeFileThresholdBytes: 1000 },
      tabs: [],
      openTab: mocks.openTab,
      revealFileInTree: mocks.revealFileInTree,
      loadGitStatus: mocks.loadGitStatus,
      activeThemeId: "dark",
    });
    commands = {
      check_file_open_safety: { kind: "safe" },
      git_blame: [{ line_number: 1, author: "Ada", date: "2026-10-01" }],
      git_get_head_content: "const a = 0;\n",
    };
    mocks.invoke.mockImplementation(async (command: string) => commands[command]);
    mocks.readFile.mockResolvedValue("const a = 1;\n");
    mocks.writeFile.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    // A file still listed as open would keep its pending save across tests.
    mocks.state.tabs = [];
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads a text file into an editable editor in its language", async () => {
    await renderTab(TS_FILE);

    expect(mocks.invoke).toHaveBeenCalledWith("check_file_open_safety", { path: TS_FILE.path, maxBytes: 1000 });
    expect(byTestId("editor")?.textContent).toBe("const a = 1;\n");
    expect(editorProps()).toMatchObject({ path: `file://${TS_FILE.path}`, language: "typescript" });
    expect(editorProps().options.readOnly).toBe(false);
  });

  it("shows the blame author beside each line number once blame is on", async () => {
    await renderTab(TS_FILE);
    expect(editorProps().options.lineNumbers(1)).toBe("1");

    act(() => buttonTitled("Toggle Git Blame (or click line numbers)")!.click());

    expect(mocks.invoke).toHaveBeenCalledWith("git_blame", { rootDir: "/workspace", filePath: TS_FILE.path });
    expect(editorProps().options.lineNumbers(1)).toBe("Ada (2026-10-01) │ 1");
    expect(editorProps().options.lineNumbers(2)).toBe("2");
    expect(editorProps().options.lineNumbersMinChars).toBe("Ada (2026-10-01) │ 1".length + 2);
  });

  it("toggles blame when the line numbers are clicked", async () => {
    await renderTab(TS_FILE);
    const editor = await mountEditor();

    await act(async () => {
      await editor.mouseDown!({ event: { browserEvent: { metaKey: false, ctrlKey: false } }, target: { type: 3 } });
    });

    expect(editorProps().options.lineNumbers(1)).toBe("Ada (2026-10-01) │ 1");
  });

  it("shows a binary file as unsupported without reading it", async () => {
    commands.check_file_open_safety = { kind: "binary", size_bytes: 2048 };

    await renderTab(TS_FILE);

    expect(byTestId("unsupported")?.dataset.size).toBe("2048");
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("opens a large file read-only until the user loads it anyway", async () => {
    commands.check_file_open_safety = { kind: "too_large", size_bytes: 5000 };

    await renderTab(TS_FILE);

    expect(container.textContent).toContain("This file is 5000 B, above the large-file threshold");
    expect(editorProps().options.readOnly).toBe(true);

    act(() => buttonNamed("Load anyway (editable)")!.click());

    expect(container.textContent).not.toContain("above the large-file threshold");
    expect(editorProps().options.readOnly).toBe(false);
  });

  it("previews an image with its decoded size and skips the text checks", async () => {
    commands.read_file_as_base64 = "iVBORw0KGgo=";

    await renderTab({ ...TS_FILE, title: "logo.png", path: "/workspace/logo.png" });

    const preview = byTestId("image-preview")!;
    expect(preview.dataset.src).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(preview.dataset.size).toBe("8");
    expect(mocks.invoke).not.toHaveBeenCalledWith("check_file_open_safety", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("git_blame", expect.anything());
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("falls back to the unsupported card when an image cannot be read", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "read_file_as_base64") throw new Error("denied");
      return commands[command];
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await renderTab({ ...TS_FILE, title: "logo.png", path: "/workspace/logo.png" });

    expect(byTestId("unsupported")?.dataset.size).toBe("0");
  });

  it("auto-saves edits to disk after a pause and refreshes git", async () => {
    await renderTab(TS_FILE);
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    act(() => editorProps().onChange("const a = 2;\n"));
    act(() => editorProps().onChange("const a = 3;\n"));
    expect(mocks.invoke).not.toHaveBeenCalledWith("write_file_disk", expect.anything());

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();
    await flush();

    expect(mocks.invoke).toHaveBeenCalledWith("write_file_disk", { path: TS_FILE.path, content: "const a = 3;\n" });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "write_file_disk")).toHaveLength(1);
    expect(mocks.loadGitStatus).toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "git_get_head_content")).toHaveLength(2);
  });

  it("lists a symbol's likely definitions on Cmd-click, best first, and opens one", async () => {
    mocks.searchProject.mockResolvedValue([
      { path: "/workspace/src/main.ts", name: "main.ts", line: 10, content: "loadUser(1);", is_content_match: true },
      { path: "/workspace/src/api.ts", name: "api.ts", line: 5, content: "  return client.loadUser(id);", is_content_match: true },
      { path: "/workspace/src/user.ts", name: "user.ts", line: 3, content: "export function loadUser(id) {", is_content_match: true },
    ]);
    await renderTab(TS_FILE);
    const editor = await mountEditor();
    const browserEvent = { metaKey: true, ctrlKey: false, clientX: 100, clientY: 50, preventDefault: vi.fn(), stopPropagation: vi.fn() };

    await act(async () => {
      await editor.mouseDown!({ event: { browserEvent }, target: { position: { lineNumber: 1, column: 5 }, type: 6 } });
    });

    expect(browserEvent.preventDefault).toHaveBeenCalled();
    expect(mocks.searchProject).toHaveBeenCalledWith({ rootDir: "/workspace", query: "loadUser", matchCase: true, wholeWord: true, isRegex: false });
    expect(container.textContent).toContain("Definitions");
    const candidates = [...container.querySelectorAll<HTMLButtonElement>('button[title$=":3"], button[title$=":10"], button[title$=":5"]')];
    expect(candidates.map((button) => button.title)).toEqual(["src/user.ts:3", "src/main.ts:10"]);

    act(() => candidates[0].click());

    expect(mocks.openTab).toHaveBeenCalledWith({ type: "file", path: "/workspace/src/user.ts", title: "user.ts", line: 3 });
    expect(container.textContent).not.toContain("Definitions");
  });

  it("says when no definition is found and closes the menu on Escape", async () => {
    mocks.searchProject.mockResolvedValue([]);
    await renderTab(TS_FILE);
    const editor = await mountEditor();

    await act(async () => {
      await editor.mouseDown!({
        event: { browserEvent: { metaKey: false, ctrlKey: true, clientX: 0, clientY: 0 } },
        target: { position: { lineNumber: 1, column: 5 }, type: 6 },
      });
    });
    expect(container.textContent).toContain("No likely definitions found");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(container.textContent).not.toContain("Definitions");
  });

  it("previews Markdown and switches to its source", async () => {
    mocks.readFile.mockResolvedValue("# Title\n");

    await renderTab({ ...TS_FILE, title: "README.md", path: "/workspace/README.md" });

    expect(byTestId("markdown")?.textContent).toBe("# Title\n");
    act(() => buttonTitled("Edit Markdown source")!.click());
    expect(byTestId("editor")?.textContent).toBe("# Title\n");
  });

  it("reads a canvas file from its VFS, without git, and reloads it when the VFS changes", async () => {
    await renderTab({ ...TS_FILE, vfsTabId: "canvas-1" });

    expect(editorProps().path).toBe("vfs://canvas-1/workspace/src/main.ts");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(buttonTitled("Open Git History of this File")).toBeNull();

    mocks.readFile.mockResolvedValue("const a = 9;\n");
    act(() => {
      window.dispatchEvent(new CustomEvent("rusty-vfs-changed", { detail: { tabId: "canvas-1", paths: ["src/main.ts"] } }));
    });
    await flush();

    expect(byTestId("editor")?.textContent).toBe("const a = 9;\n");
  });

  it("opens the file's git history scoped to its repository", async () => {
    await renderTab(TS_FILE);

    act(() => buttonTitled("Open Git History of this File")!.click());

    expect(mocks.openTab).toHaveBeenCalledWith({ type: "git-history", path: TS_FILE.path, repoPath: "/workspace" });
  });

  describe("with two tabs of one file", () => {
    const COPY: FileTabTab = { ...TS_FILE, id: "copy-1" };
    const MD_FILE: FileTabTab = { ...TS_FILE, id: "md-1", path: "/workspace/README.md", title: "README.md" };
    const MD_COPY: FileTabTab = { ...MD_FILE, id: "md-copy" };

    async function renderTabs(...tabs: FileTabTab[]) {
      mocks.state.tabs = tabs;
      act(() => root.render(<>{tabs.map((tab) => <FileTab key={tab.id} tab={tab} isActive={true} />)}</>));
      await flush();
    }

    /** The latest props of the editor each tab renders, in tab order. */
    const editors = (count: number) => mocks.editorProps.slice(-count);

    it("shows text typed in one tab in the other, with no editor of its own", async () => {
      await renderTabs(MD_FILE, MD_COPY);
      expect(container.querySelectorAll('[data-testid="markdown"]')).toHaveLength(2);
      const [sourceToggle] = container.querySelectorAll<HTMLButtonElement>('button[title="Edit Markdown source"]');
      act(() => sourceToggle.click());

      act(() => editorProps().onChange("# Typed in the source"));

      expect(byTestId("markdown")?.textContent).toBe("# Typed in the source");
    });

    it("writes each edit once, though both editors report it", async () => {
      await renderTabs(TS_FILE, COPY);
      vi.useFakeTimers();

      act(() => {
        for (const props of editors(2)) props.onChange("const a = 2;\n");
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(mocks.invoke.mock.calls.filter(([command]) => command === "write_file_disk")).toHaveLength(1);
    });

    it("still saves the edit when the tab it was typed in closes", async () => {
      await renderTabs(TS_FILE, COPY);
      vi.useFakeTimers();
      act(() => editors(2)[0].onChange("const a = 2;\n"));

      mocks.state.tabs = [COPY];
      act(() => root.render(<FileTab key={COPY.id} tab={COPY} isActive={true} />));
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(mocks.invoke).toHaveBeenCalledWith("write_file_disk", { path: TS_FILE.path, content: "const a = 2;\n" });
    });

    it("drops the pending save once the last tab of the file closes, as a single tab does", async () => {
      await renderTabs(TS_FILE);
      vi.useFakeTimers();
      act(() => editorProps().onChange("const a = 2;\n"));

      mocks.state.tabs = [];
      act(() => root.render(<></>));
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(mocks.invoke.mock.calls.filter(([command]) => command === "write_file_disk")).toHaveLength(0);
    });

    it("opens a second tab on text that has not reached the disk yet", async () => {
      await renderTabs(TS_FILE);
      act(() => editorProps().onChange("const typed = true;\n"));

      await renderTabs(TS_FILE, COPY);

      expect(editorProps().value).toBe("const typed = true;\n");
    });

    it("gives a read-only editor no value to write into the shared model", async () => {
      commands.check_file_open_safety = { kind: "too_large", size_bytes: 5000 };
      await renderTab(TS_FILE);

      expect(editorProps().value).toBeUndefined();
      expect(editorProps().defaultValue).toBe("const a = 1;\n");

      act(() => buttonNamed("Load anyway (editable)")!.click());

      expect(editorProps().value).toBe("const a = 1;\n");
    });

    it("keeps the shared Monaco model until the last tab of the file closes", async () => {
      const model = { dispose: vi.fn(), isDisposed: () => false, getEOL: () => "\n", getValue: () => "const a = 1;\n" };
      vi.stubGlobal("monaco", { editor: { getModel: () => model }, Uri: { parse: (uri: string) => uri } });
      await renderTabs(TS_FILE, COPY);
      vi.useFakeTimers();

      mocks.state.tabs = [COPY];
      act(() => root.render(<FileTab key={COPY.id} tab={COPY} isActive={true} />));
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(model.dispose).not.toHaveBeenCalled();

      mocks.state.tabs = [];
      act(() => root.render(<></>));
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(model.dispose).toHaveBeenCalledTimes(1);
    });

    it("moves the keyboard only to the active tab when arriving at a line", async () => {
      mocks.state.activeTabId = COPY.id;
      await renderTabs({ ...TS_FILE, line: 4 }, { ...COPY, line: 4 });
      vi.useFakeTimers();
      const [original, copy] = [fakeEditor(), fakeEditor()];
      const [originalProps, copyProps] = editors(2);

      act(() => {
        originalProps.onMount(original, { KeyMod: { CtrlCmd: 2048 }, KeyCode: { Enter: 3 } });
        copyProps.onMount(copy, { KeyMod: { CtrlCmd: 2048 }, KeyCode: { Enter: 3 } });
        vi.advanceTimersByTime(50);
      });

      expect(original.setPosition).toHaveBeenCalled();
      expect(original.focus).not.toHaveBeenCalled();
      expect(copy.focus).toHaveBeenCalled();
      delete mocks.state.activeTabId;
    });
  });
});
