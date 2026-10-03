// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const run = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
vi.mock("../../harness", () => ({ harness: { run, releaseSession: vi.fn(async () => {}) } }));
vi.mock("../../store/resolveExecutionProvider", () => ({
  resolveExecutionProvider: () => ({ ok: true, provider: { id: "p", name: "P", models: [] } }),
}));

import { useWorkspaceStore } from "../../store";
import { BUILT_IN_SKILL_IDS } from "../../config/skillDefinitions";
import { AUTO_MODEL_ID } from "../../services/intelligentModelSelector";
import { saveAgentModelSelection } from "../../preferences/agentModelSelection";
import { AgentTab } from "./AgentTab";
import { AUTO_FLOW } from "./behaviors/flowCatalog";
import { STARTER_WORKFLOWS, workflowKind } from "./behaviors/starterFlow";
import { useWorkflowRunStore } from "./behaviors/workflowRunStore";

const FLOW_PATH = "/ws/.rusty/workflows/flow.json";
const FLOW = {
  schema_version: 1,
  id: "flow",
  revision: 1,
  name: "Plan and build",
  nodes: [
    { id: "input", name: "Input", type: "input" },
    { id: "build", name: "Build", type: "agent" },
  ],
  edges: [{ id: "e", source: "input", target: "build", condition: "on_success" }],
};
// A stage: its first step reads the previous run's result as `context`.
const STAGE_PATH = "/ws/.rusty/workflows/stage.json";
const STAGE = {
  schema_version: 1,
  id: "stage",
  revision: 1,
  name: "Investigate",
  metadata: { switch_to: ["diagnose"] },
  nodes: [
    { id: "input", name: "Input", type: "input" },
    {
      id: "research",
      name: "Research",
      type: "agent",
      input_bindings: [
        { target: "request", source: { type: "run_input", pointer: "/request" } },
        { target: "context", source: { type: "run_input", pointer: "/context" } },
      ],
    },
  ],
  edges: [{ id: "e", source: "input", target: "research", condition: "on_success" }],
};
const CHAT_PATH = "/ws/.rusty/chats/old.json";
const files: Record<string, string> = {};
const writes: Array<{ path: string; content: string }> = [];

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("Agent chat workflows", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const tab = { id: "agent", type: "agent", title: "Agent", status: "idle", dirty: false } as never;
  // The app's CustomSelect: a button that opens a listbox in a portal.
  const select = () => container.querySelector("#agent-workflow-select") as HTMLButtonElement;
  const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
  const LABELS: Record<string, string> = { "": "Single agent", [FLOW_PATH]: "Workflow: Plan and build", [STAGE_PATH]: "Workflow: Investigate", [AUTO_FLOW]: "Auto: choose a workflow for each message" };
  const choose = async (value: string) => {
    await act(async () => select().click());
    await act(async () => options().find((option) => option.textContent === LABELS[value])!.click());
    await flush();
  };

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Element.prototype.scrollIntoView = vi.fn();
    for (const key of Object.keys(files)) delete files[key];
    writes.length = 0;
    files[FLOW_PATH] = JSON.stringify(FLOW);
    files[STAGE_PATH] = JSON.stringify(STAGE);
    files[CHAT_PATH] = JSON.stringify({
      tabId: "agent",
      messages: [{ id: "m1", role: "user", content: "earlier request", timestamp: "2026-09-29" }],
      savedAt: "2026-09-29T10:00:00Z",
      workflow: FLOW_PATH,
    });
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      switch (command) {
        case "get_directory_structure": {
          const dir = `${String(args.rootDir)}/`;
          return Object.keys(files)
            .filter((path) => path.startsWith(dir))
            .map((path) => ({ name: path.slice(dir.length), path, is_dir: false }));
        }
        case "read_file_disk": {
          const content = files[String(args.path)];
          if (content === undefined) throw new Error("not found");
          return content;
        }
        case "write_file_disk":
          writes.push({ path: String(args.path), content: String(args.content) });
          files[String(args.path)] = String(args.content);
          return undefined;
        case "save_chat_history":
          return "/ws/.rusty/chats/new.json";
        default:
          return undefined;
      }
    });
    run.mockReset();
    run.mockImplementation(() => ({ runId: "r", started: Promise.resolve(), done: new Promise(() => {}), cancel: vi.fn() }));
    useWorkflowRunStore.setState({ agentRequest: undefined, runs: {} });
    useWorkspaceStore.setState({ rootPath: "/ws", agentChats: { agent: [] } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<AgentTab tab={tab} />));
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("offers the picker with the built-in workflows, stages labelled, and the workspace's own", async () => {
    await act(async () => select().click());
    const builtIn = STARTER_WORKFLOWS.map((document) => `${workflowKind(document) === "stage" ? "Stage" : "Workflow"}: ${document.name}`);
    expect(options().map((option) => option.textContent)).toEqual([
      "Single agent",
      ...builtIn,
      "Workflow: Plan and build",
      "Workflow: Investigate",
    ]);
    // Auto needs OpenRouter and a JEV model.
    expect(options().map((option) => option.textContent).some((label) => label?.startsWith("Auto"))).toBe(false);
    expect(builtIn).toContain("Stage: Research & analyze");
    expect(builtIn[0]).toBe("Workflow: Plan, build, verify");
    await act(async () => select().click());
    expect(container.textContent).not.toContain("Each message runs one agent loop.");
  });

  it("restores a saved chat's workflow and forgets it for a new chat", async () => {
    // History entries are clickable rows, not buttons.
    await act(async () => {
      [...container.querySelectorAll("div")]
        .filter((div) => div.textContent?.includes("earlier request"))
        .at(-1)!
        .click();
    });
    await flush();
    expect(select().textContent).toBe("Workflow: Plan and build");
    expect(container.querySelector('[data-testid="workflow-chip"]')?.textContent).toContain("Plan and build");
    expect(container.querySelector('ol[aria-label="Workflow steps"]')?.textContent).toContain("Build");

    // Changing it in a saved chat saves the chat right away.
    await choose("");
    expect(JSON.parse(files[CHAT_PATH]).workflow).toBeUndefined();
    await choose(FLOW_PATH);
    expect(JSON.parse(files[CHAT_PATH]).workflow).toBe(FLOW_PATH);

    await act(async () => (container.querySelector('[title="New chat"]') as HTMLButtonElement)?.click());
    await flush();
    expect(select().textContent).toBe("Single agent");
  });

  it("adopts a workflow handed over by the Behaviors tab", async () => {
    await act(async () => {
      useWorkflowRunStore.getState().requestAgentWorkflow(FLOW_PATH);
    });
    await flush();
    expect(select().textContent).toBe("Workflow: Plan and build");
    expect(useWorkflowRunStore.getState().agentRequest).toBeUndefined();
  });

  it("sends the chat's workflow with the message and shows it running", async () => {
    await choose(FLOW_PATH);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "add password reset");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    const [capability, input] = run.mock.calls[0];
    expect(capability).toBe("agent_chat");
    expect(input.workflow).toEqual({ definition: FLOW, input: { request: "add password reset", attachments: [] } });
    expect(useWorkflowRunStore.getState().runs.flow?.status).toBe("running");
    expect(container.textContent).toContain("Starting the workflow…");
    expect(select().disabled).toBe(true);

    // Step progress from the run: the bar names the current step, the chat
    // marks where the agent step's output begins, the status line names it.
    const onEvent = run.mock.calls[0][3] as (event: unknown) => void;
    await act(async () => {
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "input", name: "Input", status: "running", attempt: 1 });
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "input", name: "Input", status: "succeeded", attempt: 1 });
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "build", name: "Build", status: "running", attempt: 1 });
      onEvent({ kind: "command_output", content: "checked package.json\n" });
      onEvent({ kind: "token", content: "Reading the auth module", messageId: "m1" });
    });
    await flush(200);
    expect(container.textContent).toContain("Running step 2 of 2: Build");
    expect(container.textContent).toContain("▶ Build");
    expect(container.textContent).not.toContain("▶ Input");
    expect(container.textContent).toContain("Build · Generating response…");
    const activityMessage = useWorkspaceStore.getState().agentChats.agent.find((message) => message.role === "console");
    expect(activityMessage?.activityEntries).toEqual([
      { content: "▶ Build", kind: "update" },
      { content: "checked package.json", kind: "tool" },
    ]);
    // The new conversation is saved with its workflow.
    expect(savedWorkflow()).toBe(FLOW_PATH);
  });

  it("starts a new activity and response pair for every agent workflow step", async () => {
    files[FLOW_PATH] = JSON.stringify({
      ...FLOW,
      nodes: [
        { id: "input", name: "Input", type: "input" },
        { id: "build", name: "Build", type: "agent" },
        { id: "verify", name: "Verify", type: "agent" },
      ],
      edges: [
        { id: "build-edge", source: "input", target: "build", condition: "on_success" },
        { id: "verify-edge", source: "build", target: "verify", condition: "on_success" },
      ],
    });
    await choose(FLOW_PATH);
    await send("build and verify it");

    const onEvent = run.mock.calls[0][3] as (event: unknown) => void;
    await act(async () => {
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "build", name: "Build", status: "running", attempt: 1 });
      onEvent({ kind: "command_output", content: "building" });
      onEvent({ kind: "token", content: "Build finished.", messageId: "shared" });
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "build", name: "Build", status: "succeeded", attempt: 1 });
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "verify", name: "Verify", status: "running", attempt: 1 });
      onEvent({ kind: "command_output", content: "testing" });
      onEvent({ kind: "token", content: "Verification passed.", messageId: "shared" });
    });
    await flush(200);

    const messages = useWorkspaceStore.getState().agentChats.agent
      .filter((message) => message.role === "console" || message.role === "assistant");
    expect(messages.map((message) => message.role)).toEqual([
      "console", "assistant", "console", "assistant",
    ]);
    expect(messages[0].activityEntries).toEqual([
      { content: "▶ Build", kind: "update" },
      { content: "building", kind: "tool" },
    ]);
    expect(messages[1].content).toBe("Build finished.");
    expect(messages[2].activityEntries).toEqual([
      { content: "▶ Verify", kind: "update" },
      { content: "testing", kind: "tool" },
    ]);
    expect(messages[3].content).toBe("Verification passed.");
  });

  async function send(text: string) {
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
  }

  it("keeps the skill on Build while a workflow is followed, whatever skill was picked", async () => {
    useWorkspaceStore.getState().setActiveSkill(BUILT_IN_SKILL_IDS.PLAN);
    await flush();
    expect(container.textContent).not.toContain("tools set per step");

    await choose(FLOW_PATH);
    expect(container.textContent).toContain("tools set per step");
    await send("add password reset");
    expect(run.mock.calls[0][1].skill.name).toBe("build");
    // The lock is not a change of the user's own choice.
    expect(useWorkspaceStore.getState().activeSkillId).toBe(BUILT_IN_SKILL_IDS.PLAN);
  });

  it("uses the picked skill again for a single agent", async () => {
    useWorkspaceStore.getState().setActiveSkill(BUILT_IN_SKILL_IDS.PLAN);
    await flush();
    await choose("");
    await send("explain this");
    expect(run.mock.calls[0][1].skill.name).toBe("plan");
    expect(run.mock.calls[0][1].workflow).toBeUndefined();
    expect(container.textContent).not.toContain("tools set per step");
  });

  it("gives a stage the last result in the chat as context, so a long job can be steered between stages", async () => {
    useWorkspaceStore.setState({
      agentChats: {
        agent: [
          { id: "u1", role: "user", content: "how does sync work", timestamp: "t" },
          { id: "a1", role: "assistant", content: "**▶ Research**", timestamp: "t" },
          { id: "a2", role: "assistant", content: "## Findings\nThe queue lives in sync.rs.", timestamp: "t" },
          { id: "a3", role: "assistant", content: "Error: network down", timestamp: "t" },
        ],
      },
    });
    await choose(STAGE_PATH);
    expect(container.textContent).not.toContain("building on the last result in this chat");
    await send("go with the queue, skip the migration");
    expect(run.mock.calls[0][1].workflow.input).toMatchObject({
      request: "go with the queue, skip the migration",
      attachments: [],
      context: "## Findings\nThe queue lives in sync.rs.",
      conversation: [{ role: "user", content: "how does sync work" }, { role: "assistant", content: "## Findings\nThe queue lives in sync.rs." }, { role: "user", content: "go with the queue, skip the migration" }],
    });
  });

  it("gives a stage an empty context in a fresh chat", async () => {
    await choose(STAGE_PATH);
    await send("investigate the cache");
    expect(run.mock.calls[0][1].workflow.input).toMatchObject({ request: "investigate the cache", attachments: [], context: "" });
  });

  const finished = (response: string) => ({
    runId: "r",
    started: Promise.resolve(),
    cancel: vi.fn(),
    done: Promise.resolve({ status: "completed", result: { response, modifiedFiles: [], subagents: [] } }),
  });

  describe("a message after a workflow has finished", () => {
    it("reaches a workflow that reads no context with the conversation so far, not just the new words", async () => {
      run.mockImplementationOnce(() => finished("# Audit verdict\nThe build is incomplete: the catalog UI is missing."));
      await choose(FLOW_PATH);
      await send("implement the profiles");
      await send("please fix the gaps");

      expect(run).toHaveBeenCalledTimes(2);
      const { request, attachments, context } = run.mock.calls[1][1].workflow.input;
      expect(attachments).toEqual([]);
      expect(context).toBeUndefined();
      // The new message leads and stays recognisable as the request ...
      expect(request.startsWith("please fix the gaps")).toBe(true);
      // ... and the earlier request and its result travel with it.
      expect(request).toContain("implement the profiles");
      expect(request).toContain("The build is incomplete: the catalog UI is missing.");
    });

    it("sends a first message exactly as typed", async () => {
      await choose(FLOW_PATH);
      await send("implement the profiles");
      expect(run.mock.calls[0][1].workflow.input).toMatchObject({ request: "implement the profiles", attachments: [] });
    });
  });

  describe("the Result of a workflow", () => {
    const reportWrites = () => writes.filter((write) => write.path.includes("/.rusty/findings/"));

    it("is saved as Markdown when the run changed nothing, and the chat says where", async () => {
      run.mockImplementationOnce(() => finished("# Hosting options\nGitHub Pages is free for public repositories."));
      await choose(FLOW_PATH);
      await send("what is the best hosting for the website");

      expect(reportWrites()).toHaveLength(1);
      const [{ path, content }] = reportWrites();
      expect(path).toMatch(/^\/ws\/\.rusty\/findings\/\d{4}-\d{2}-\d{2}-\d{6}-what-is-the-best-hosting-for-the-website\.md$/);
      expect(content).toContain("# what is the best hosting for the website");
      expect(content).toContain("- Workflow: Plan and build");
      expect(content).toContain("## Result\n\n# Hosting options\nGitHub Pages is free for public repositories.");
      expect(container.textContent).toContain("Result saved to");
      expect(container.textContent).toContain(".rusty/findings/");
    });

    it("is not saved when the run changed files, because the changes are the outcome", async () => {
      run.mockImplementationOnce(() => ({
        runId: "r", started: Promise.resolve(), cancel: vi.fn(),
        done: Promise.resolve({ status: "completed", result: { response: "Added password reset.", modifiedFiles: ["src/auth.ts"], subagents: [] } }),
      }));
      await choose(FLOW_PATH);
      await send("add password reset");
      expect(reportWrites()).toHaveLength(0);
      expect(container.textContent).not.toContain("Result saved to");
    });

    it("is not saved when a command changed files during the run", async () => {
      run.mockImplementationOnce((_capability: string, _input: unknown, _host: unknown, onEvent: (event: unknown) => void) => {
        onEvent({ kind: "files_changed", paths: ["README.md"] });
        return finished("Updated the readme with git.");
      });
      await choose(FLOW_PATH);
      await send("update the readme");
      expect(reportWrites()).toHaveLength(0);
    });

    it("is not saved for a single agent, which has no Result node", async () => {
      run.mockImplementationOnce(() => finished("It does nothing special."));
      await choose("");
      await send("what does ?? do");
      expect(reportWrites()).toHaveLength(0);
    });
  });

  describe("with Auto flow selection", () => {
    const model = (remoteId: string) => ({ id: `openrouter/${remoteId}`, remoteId, name: remoteId, supported: true });
    const fetchStub = vi.fn();
    const decisionCalls = () => fetchStub.mock.calls.filter(([url]) => String(url).includes("/decisions"));
    const respond = (choice: string, confidence: number, probabilities: Record<string, number>) =>
      fetchStub.mockImplementation(async (url: unknown) => ({
        ok: true,
        status: 200,
        text: async () => String(url).includes("/decisions")
          ? JSON.stringify({ answers: { decision: { type: "choice", choice, confidence, probabilities } } })
          : "{}",
      }));
    const questionButton = (label: string) =>
      [...container.querySelectorAll("button")].find((button) => button.textContent?.trim().startsWith(label)) as HTMLButtonElement | undefined;
    const workflowId = () => run.mock.calls[0]?.[1].workflow?.definition?.id as string | undefined;

    beforeEach(async () => {
      fetchStub.mockReset();
      fetchStub.mockImplementation(async () => ({ ok: true, status: 200, text: async () => "{}" }));
      vi.stubGlobal("fetch", fetchStub);
      useWorkspaceStore.setState({
        customProviders: [{
          id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "or-key", apiType: "openai-completions", authType: "bearer",
          models: [model("typesafe/jev-1.13"), model("vendor/standard")],
        }] as never,
        activeCustomProviderId: "openrouter",
        providerStatus: {},
      });
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<AgentTab tab={tab} />));
      await flush();
    });

    it("is offered once OpenRouter and a JEV model are connected", async () => {
      await act(async () => select().click());
      expect(options().map((option) => option.textContent)).toContain("Auto: choose a workflow for each message");
      await act(async () => select().click());
    });

    it("runs a confident read-only pick straight away, says what it chose, and builds on the last result", async () => {
      respond("investigate", 0.9, { investigate: 0.9, single_agent: 0.1 });
      useWorkspaceStore.setState({
        agentChats: { agent: [{ id: "a0", role: "assistant", content: "Earlier answer about sync.", timestamp: "t" }] },
      });
      await choose(AUTO_FLOW);
      await send("how does sync work");
      expect(decisionCalls()).toHaveLength(1);
      expect(String(decisionCalls()[0][1].body)).toContain("how does sync work");
      expect(workflowId()).toBe("rusty-ide.builtin.investigate");
      expect(run.mock.calls[0][1].workflow.input).toMatchObject({ request: "how does sync work", attachments: [], context: "Earlier answer about sync." });
      expect(run.mock.calls[0][1].skill.name).toBe("build");
      expect(useWorkspaceStore.getState().agentChats.agent.some((message) => message.content === "↳ AUTO · Stage: Research & analyze (90% confidence)\n")).toBe(true);
      expect(questionButton("Run ")).toBeUndefined();
      // The bar follows the workflow it chose.
      expect(container.querySelector('[data-testid="workflow-chip"]')?.textContent).toContain("Auto · Research & analyze");
    });

    it("keeps going after a finished workflow: each next message is routed on its own, with the conversation", async () => {
      respond("investigate", 0.9, { investigate: 0.9, single_agent: 0.1 });
      run.mockImplementationOnce(() => finished("## Findings\nSync lives in queue.rs."));
      run.mockImplementationOnce(() => finished("Retries are attempted three times."));
      await choose(AUTO_FLOW);
      await send("how does sync work");
      expect(workflowId()).toBe("rusty-ide.builtin.investigate");

      // The router is told what was asked and found, so "and what about..." is read in its setting.
      await send("and what about retries");
      expect(run).toHaveBeenCalledTimes(2);
      const routerState = String(decisionCalls()[1][1].body);
      expect(routerState).toContain("and what about retries");
      expect(routerState).toContain("how does sync work");
      expect(routerState).toContain("Sync lives in queue.rs.");
      expect(run.mock.calls[1][1].workflow.input).toMatchObject({ request: "and what about retries", attachments: [], context: "## Findings\nSync lives in queue.rs." });

      // A message the router sends to the single agent still has everything said so far.
      run.mockImplementationOnce(() => finished("Retries back off twice."));
      respond("single_agent", 0.9, { single_agent: 0.9, investigate: 0.1 });
      await send("thanks, explain the backoff");
      expect(run).toHaveBeenCalledTimes(3);
      const single = run.mock.calls[2][1];
      expect(single.workflow).toBeUndefined();
      expect(single.chatHistory.map((m: { content: string }) => m.content)).toEqual(expect.arrayContaining([
        "how does sync work",
        expect.stringContaining("## Findings\nSync lives in queue.rs."),
        "and what about retries",
        expect.stringContaining("Retries are attempted three times."),
      ]));
      expect(container.textContent).not.toContain("Agent needs your decision");
    });

    it("after an analysis, picks the build workflow on \"implement it\" by itself and hands it the analysis", async () => {
      respond("investigate", 0.9, { investigate: 0.9, single_agent: 0.1 });
      run.mockImplementationOnce(() => finished("## Findings\nRetries live in queue.rs; add jitter there."));
      await choose(AUTO_FLOW);
      await send("how do retries work");
      expect(workflowId()).toBe("rusty-ide.builtin.investigate");

      respond("implement", 0.93, { implement: 0.93, design: 0.05, single_agent: 0.02 });
      await send("ok, implement that");
      expect(run).toHaveBeenCalledTimes(2);
      const [, build] = run.mock.calls[1];
      expect(build.workflow.definition.id).toBe("rusty-ide.builtin.implement");
      expect(build.workflow.input.request).toBe("ok, implement that");
      expect(build.workflow.input.context).toContain("Retries live in queue.rs; add jitter there.");
      // No question, no menu: it just started, and said what it chose.
      expect(container.textContent).not.toContain("Agent needs your decision");
      expect(useWorkspaceStore.getState().agentChats.agent.some((message) => message.content === "↳ AUTO · Stage: Build & verify (93% confidence) · can change files\n")).toBe(true);
    });

    it("still has the analysis when a quick answer came between it and \"implement it\"", async () => {
      const analysis = `## Findings\n${"Retries live in queue.rs; add jitter there. ".repeat(30)}`;
      useWorkspaceStore.setState({
        agentChats: {
          agent: [
            { id: "u1", role: "user", content: "how do retries work", timestamp: "t" },
            { id: "a1", role: "assistant", content: analysis, timestamp: "t" },
            { id: "u2", role: "user", content: "is jitter fine?", timestamp: "t" },
            { id: "a2", role: "assistant", content: "Yes, jitter is fine.", timestamp: "t" },
          ],
        },
      });
      respond("implement", 0.9, { implement: 0.9, single_agent: 0.1 });
      await choose(AUTO_FLOW);
      await send("ok, implement it");
      expect(workflowId()).toBe("rusty-ide.builtin.implement");
      const { context } = run.mock.calls[0][1].workflow.input;
      expect(context).toContain("Retries live in queue.rs; add jitter there.");
      expect(context).toContain("Latest reply:\nYes, jitter is fine.");
    });

    it("answers with the single agent when that fits, under the skill the user picked", async () => {
      respond("single_agent", 0.92, { single_agent: 0.92, investigate: 0.08 });
      useWorkspaceStore.getState().setActiveSkill(BUILT_IN_SKILL_IDS.PLAN);
      await flush();
      await choose(AUTO_FLOW);
      await send("what does ?? do in TypeScript");
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][1].workflow).toBeUndefined();
      expect(run.mock.calls[0][1].skill.name).toBe("plan");
      expect(useWorkspaceStore.getState().agentChats.agent.some((message) => message.content === "↳ AUTO · Single agent (92% confidence)\n")).toBe(true);
    });

    it("runs a confident pick that can change files without asking, and says it can", async () => {
      respond("implement", 0.9, { implement: 0.9, design: 0.07, single_agent: 0.03 });
      await choose(AUTO_FLOW);
      await send("go ahead and build it");
      expect(workflowId()).toBe("rusty-ide.builtin.implement");
      expect(questionButton("Run ")).toBeUndefined();
      expect(container.textContent).not.toContain("Agent needs your decision");
      expect(useWorkspaceStore.getState().agentChats.agent.some((message) => message.content === "↳ AUTO · Stage: Build & verify (90% confidence) · can change files\n")).toBe(true);
    });

    it("answers with the single agent, without asking, when it is unsure", async () => {
      respond("investigate", 0.4, { investigate: 0.4, design: 0.35, single_agent: 0.15, diagnose: 0.1 });
      await choose(AUTO_FLOW);
      await send("hmm, the sync thing");
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][1].workflow).toBeUndefined();
      expect(container.textContent).not.toContain("Which workflow should handle this?");
      expect(useWorkspaceStore.getState().agentChats.agent.some((message) => message.content === "↳ AUTO · Single agent (no workflow was a clear fit)\n")).toBe(true);
    });

    it("answers directly, saying why, when the router cannot be reached", async () => {
      fetchStub.mockImplementation(async (url: unknown) => {
        if (String(url).includes("/decisions")) throw new Error("offline");
        return { ok: true, status: 200, text: async () => "{}" };
      });
      await choose(AUTO_FLOW);
      await send("how does sync work");
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][1].workflow).toBeUndefined();
      expect(useWorkspaceStore.getState().agentChats.agent.some((message) => message.content.includes("Could not choose a workflow"))).toBe(true);
    });

    describe("flow switching", () => {
      const toggleOn = async () => {
        await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
      };
      const handOver = (id: string, name: string, path: string) => ({
        runId: "r",
        started: Promise.resolve(),
        cancel: vi.fn(),
        done: Promise.resolve({
          status: "completed",
          result: {
            response: `↪ AUTO · Handing over to ${name} (86% confidence): it fits.`,
            modifiedFiles: [],
            subagents: [],
            switchTo: { id, name, path, reason: "it fits", confidence: 0.86, context: `Handed over: ${id} context`, from: { name: "Investigate", step: "Research" } },
          },
        }),
      });
      const pending = () => ({ runId: "r", started: Promise.resolve(), done: new Promise(() => {}), cancel: vi.fn() });

      it("tells a run which workflows it may hand over to when the chat allows switching", async () => {
        await choose(STAGE_PATH);
        await toggleOn();
        await send("investigate the cache");
        const config = run.mock.calls[0][1].flowSwitching;
        expect(config).toMatchObject({ router: { apiKey: "or-key", jevModelId: "typesafe/jev-1.13" }, workflowName: "Investigate" });
        expect(config.targets).toEqual([expect.objectContaining({ id: "diagnose", path: "builtin:diagnose", name: "Stage: Debug & plan a fix", edits: false })]);
        expect(config.targets[0].when).toMatch(/broken or failing/);
      });

      it("tells a run nothing about hand-overs unless the chat allows switching", async () => {
        await choose(STAGE_PATH);
        await send("investigate the cache");
        expect(run.mock.calls[0][1].flowSwitching).toBeUndefined();
      });

      it("offers nothing to hand over to when the workflow declares no targets", async () => {
        await choose(FLOW_PATH);
        await toggleOn();
        await send("add password reset");
        expect(run.mock.calls[0][1].flowSwitching).toBeUndefined();
      });

      it("carries on in the workflow it handed over to, in the same turn, with the finished work as context", async () => {
        run.mockImplementationOnce(() => handOver("diagnose", "Stage: Debug & plan a fix", "builtin:diagnose"));
        run.mockImplementation(pending);
        await choose(STAGE_PATH);
        await toggleOn();
        await send("investigate the cache");

        expect(run).toHaveBeenCalledTimes(2);
        const [, second] = run.mock.calls[1];
        expect(second.workflow.definition.id).toBe("rusty-ide.builtin.diagnose");
        expect(second.workflow.input).toMatchObject({ request: "investigate the cache", attachments: [], context: "Handed over: diagnose context" });
        expect(second.skill.name).toBe("build");
        // The announcement is in the chat, and the turn did not end.
        expect(container.textContent).toContain("↪ AUTO · Handing over to Stage: Debug & plan a fix (86% confidence): it fits.");
        expect(container.querySelector('ol[aria-label="Workflow steps"]')?.textContent).toMatch(/Debug.*Plan/);
        // Only one user message: the hand-over is not a new message.
        expect((useWorkspaceStore.getState().agentChats.agent ?? []).filter((m) => m.role === "user")).toHaveLength(1);
        // A chat that followed one workflow now follows the other, and keeps it.
        expect(select().textContent).toBe("Stage: Debug & plan a fix");
        // Later saves of a conversation overwrite its file in place.
        const lastWrite = [...writes].reverse().find((write) => write.path.includes("/chats/"));
        expect(JSON.parse(lastWrite!.content).workflow).toBe("builtin:diagnose");
      });

      it("saves no report for a run that handed over: its work travels on and is already in the chat", async () => {
        run.mockImplementationOnce(() => handOver("diagnose", "Stage: Debug & plan a fix", "builtin:diagnose"));
        run.mockImplementation(pending);
        await choose(STAGE_PATH);
        await toggleOn();
        await send("investigate the cache");
        expect(run).toHaveBeenCalledTimes(2);
        expect(writes.filter((write) => write.path.includes("/.rusty/findings/"))).toHaveLength(0);
        expect(container.textContent).not.toContain("Result saved to");
      });

      it("never runs a workflow twice in a turn, and the second run may not hand back", async () => {
        run.mockImplementationOnce(() => handOver("diagnose", "Stage: Debug & plan a fix", "builtin:diagnose"));
        run.mockImplementation(pending);
        await choose(STAGE_PATH);
        await toggleOn();
        await send("investigate the cache");
        const targets = (run.mock.calls[1][1].flowSwitching?.targets ?? []).map((target: { id: string }) => target.id);
        expect(targets).not.toContain("diagnose");
        expect(targets).not.toContain("stage");
        expect(targets.length).toBeGreaterThan(0);
      });

      it("stops handing over after two switches in a turn", async () => {
        run.mockImplementationOnce(() => handOver("diagnose", "Stage: Debug & plan a fix", "builtin:diagnose"));
        run.mockImplementationOnce(() => handOver("investigate", "Stage: Research & analyze", "builtin:investigate"));
        run.mockImplementationOnce(() => handOver("security-audit", "Stage: Security audit & fix plan", "builtin:security-audit"));
        run.mockImplementation(pending);
        await choose(STAGE_PATH);
        await toggleOn();
        await send("investigate the cache");
        // Two hand-overs, so three runs; a third hand-over is not followed and the turn ends.
        expect(run).toHaveBeenCalledTimes(3);
        expect(run.mock.calls[2][1].flowSwitching).toBeUndefined();
        expect(container.textContent).toContain("Ready");
      });

      it("keeps an Auto chat on Auto while the bar follows the workflow it handed over to", async () => {
        respond("investigate", 0.9, { investigate: 0.9, single_agent: 0.1 });
        run.mockImplementationOnce(() => handOver("diagnose", "Stage: Debug & plan a fix", "builtin:diagnose"));
        run.mockImplementation(pending);
        await choose(AUTO_FLOW);
        await toggleOn();
        await send("how does sync work");
        expect(run).toHaveBeenCalledTimes(2);
        expect(select().textContent).toBe("Auto: choose a workflow for each message");
        expect(container.querySelector('[data-testid="workflow-chip"]')?.textContent).toContain("Auto · Debug & plan a fix");
      });
    });

    it("remembers Auto and the flow switching choice with the chat", async () => {
      respond("investigate", 0.9, { investigate: 0.9, single_agent: 0.1 });
      await choose(AUTO_FLOW);
      const toggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(toggle.checked).toBe(false);
      await act(async () => toggle.click());
      expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
      await send("how does sync work");
      const saved = JSON.parse(String((invoke.mock.calls.filter(([command]) => command === "save_chat_history").at(-1)![1] as { content: string }).content));
      expect(saved.workflow).toBe(AUTO_FLOW);
      expect(saved.flowSwitching).toBe(true);
    });
  });

  describe("with AUTO model selection", () => {
    const model = (remoteId: string) => ({ id: `openrouter/${remoteId}`, remoteId, name: remoteId, supported: true });
    const level = (name: string) => `openrouter:openrouter/vendor/${name}`;
    const fetchStub = vi.fn();
    // The JEV Decisions calls, apart from unrelated traffic such as the model catalog refresh.
    const decisionCalls = () => fetchStub.mock.calls.filter(([url]) => String(url).includes("/decisions"));

    beforeEach(async () => {
      fetchStub.mockReset();
      vi.stubGlobal("fetch", fetchStub);
      useWorkspaceStore.setState({
        customProviders: [{
          id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "or-key", apiType: "openai-completions", authType: "bearer",
          models: [model("typesafe/jev-1.13"), model("vendor/light"), model("vendor/standard"), model("vendor/heavy")],
        }] as never,
        activeCustomProviderId: "openrouter",
        providerStatus: {},
        intelligentModelSelectionSettings: {
          enabled: true, jevModelId: null,
          levelModels: { light: level("light"), standard: level("standard"), heavy: level("heavy") },
          decisionShadowEnabled: false, decisionToolEnabled: false, decisionConfidenceThreshold: 0.6, riskReviewEnabled: false,
        },
      });
      saveAgentModelSelection(AUTO_MODEL_ID);
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<AgentTab tab={tab} />));
      await flush();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it("lets each step of a workflow pick its own model instead of rating the whole message once", async () => {
      await choose(FLOW_PATH);
      await send("add password reset");
      expect(decisionCalls()).toHaveLength(0);
      const input = run.mock.calls[0][1];
      // Steps start on the Standard level's model; each moves to its own level before its first turn.
      expect(input.model).toBe("openrouter/vendor/standard");
      expect(input.autoStepModels).toEqual({
        apiKey: "or-key",
        jevModelId: "typesafe/jev-1.13",
        levels: {
          light: { providerId: "openrouter", model: "openrouter/vendor/light", name: "vendor/light" },
          standard: { providerId: "openrouter", model: "openrouter/vendor/standard", name: "vendor/standard" },
          heavy: { providerId: "openrouter", model: "openrouter/vendor/heavy", name: "vendor/heavy" },
        },
      });
      expect(input.workflow.definition).toEqual(FLOW);
    });

    it("still rates a single-agent message once, up front", async () => {
      fetchStub.mockResolvedValue({
        ok: true, status: 200,
        text: async () => JSON.stringify({ answers: { level: { type: "score", confidence: 0.9, probabilities: { 0: 0.05, 1: 0.05, 2: 0.9 } } } }),
      });
      await send("redesign the sync engine");
      expect(decisionCalls()).toHaveLength(1);
      const input = run.mock.calls[0][1];
      expect(input.model).toBe("openrouter/vendor/heavy");
      expect(input.autoStepModels).toBeUndefined();
    });
  });
});

function savedWorkflow(): string | undefined {
  const call = invoke.mock.calls.find(([command]) => command === "save_chat_history");
  return call ? JSON.parse(String((call[1] as { content: string }).content)).workflow : undefined;
}
