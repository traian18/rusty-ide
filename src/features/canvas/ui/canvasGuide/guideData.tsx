import { CheckCircle2, FileText, GitMerge, Globe, MessageSquare, Play } from "lucide-react";

export type NodeKind = "global" | "task" | "context" | "mcp" | "sticky" | "boundary";

export interface NodeGuide {
  kind: NodeKind;
  title: string;
  eyebrow: string;
  description: string;
  details: string[];
}

export const nodeGuides: NodeGuide[] = [
  {
    kind: "global",
    title: "Global Explorer",
    eyebrow: "Plan the Rusty",
    description: "The reasoning center for this canvas. Give it your feature brief, explore the codebase, and generate an editable graph of tasks and supporting context.",
    details: ["One per Rusty", "Generates task and context nodes", "Uses the model and skill you select"],
  },
  {
    kind: "task",
    title: "Task Node",
    eyebrow: "Implement one bounded change",
    description: "A focused unit of execution. It receives only its connected context and upstream work, then writes its result into an isolated virtual workspace for review.",
    details: ["Choose a model per task", "Inspect the diff before integration", "Iterate through the node chat"],
  },
  {
    kind: "context",
    title: "Context Node",
    eyebrow: "Control what the model sees",
    description: "Attach a file, folder, or written instruction to the tasks that need it. Explicit context keeps generations grounded and makes their inputs visible to you.",
    details: ["Search or drag in project files", "Add architectural guidance", "Connect it only where relevant"],
  },
  {
    kind: "mcp",
    title: "MCP Node",
    eyebrow: "Bring in external knowledge",
    description: "Connect a configured MCP server to a task when implementation depends on information outside the repository, such as documentation, services, or project systems.",
    details: ["Select a configured server", "Describe what should be fetched", "Share the result with connected tasks"],
  },
  {
    kind: "sticky",
    title: "Sticky Note",
    eyebrow: "Keep human reasoning visible",
    description: "Record an assumption, question, decision, or reminder directly beside the work it concerns. Sticky notes never execute and never spend tokens.",
    details: ["Capture discoveries as you iterate", "Document decisions in place", "Use colors to build your own visual language"],
  },
  {
    kind: "boundary",
    title: "Boundary",
    eyebrow: "Give a large graph structure",
    description: "Group related work into a named visual area. Boundaries make large Rustys navigable without changing execution or forcing an artificial hierarchy.",
    details: ["Group a concern or subsystem", "Jump between named regions", "Keep 100+ node canvases legible"],
  },
];

export const workflow = [
  {
    icon: MessageSquare,
    number: "01",
    phase: "Discover",
    title: "Explore the feature",
    text: "Begin in a normal chat. Investigate the existing code, compare approaches, and turn a vague request into a decision you are prepared to implement.",
    actions: ["Choose the model that fits the difficulty of the discussion.", "Use Inline Chat when a selected line or file needs focused explanation.", "Identify constraints, existing contracts, risks, and unresolved questions."],
    ready: "You can explain the desired behavior and what is out of scope.",
  },
  {
    icon: FileText,
    number: "02",
    phase: "Discover",
    title: "Capture the brief",
    text: "Extract the useful result of that conversation into a Markdown file. The brief is durable project context—not knowledge trapped inside chat history.",
    actions: ["Record the objective, contracts, acceptance criteria, and important decisions.", "Keep the brief in the repository so both you and future models can inspect it."],
    ready: "The Markdown file is specific enough to review without the original chat.",
  },
  {
    icon: Globe,
    number: "03",
    phase: "Build",
    title: "Generate the graph",
    text: "Open a Rusty, attach the brief, and ask the Global Explorer to propose an implementation graph. The proposal is a starting point, not an order to execute.",
    actions: ["Review task boundaries and connect the files or guidance each task needs.", "Add, remove, split, or reorder nodes until the graph matches your understanding."],
    ready: "Every task has a bounded purpose, relevant context, and sensible dependencies.",
  },
  {
    icon: Play,
    number: "04",
    phase: "Build",
    title: "Iterate node by node",
    text: "Work one bounded task at a time. Select its model and skill, run it, inspect the generated files and diff, then use the node chat to correct or deepen the result.",
    actions: ["Add context when the model guessed, duplicated behavior, or missed a contract.", "Rerun and review until you understand why each change belongs in the codebase."],
    ready: "You can explain the change, the contract it uses, and how it was verified.",
  },
  {
    icon: GitMerge,
    number: "05",
    phase: "Integrate",
    title: "Reconcile convergence",
    text: "Independent tasks may converge on the same file. Open reconciliation to compare their intended changes and compose one coherent implementation.",
    actions: ["Treat files touched by several nodes as integration hotspots, not ordinary diffs.", "Use a stronger model only when collision complexity actually requires it."],
    ready: "Overlapping work preserves every required behavior without duplicate implementations.",
  },
  {
    icon: CheckCircle2,
    number: "06",
    phase: "Integrate",
    title: "Review and merge",
    text: "Review the Rusty as a whole, apply its virtual changes to the real workspace, and use Git as the final integration boundary.",
    actions: ["Inspect the combined diff and run the relevant tests and checks.", "Merge only when the implementation still matches the Markdown brief."],
    ready: "The code is coherent, verified, and understandable enough for you to maintain.",
  },
];
