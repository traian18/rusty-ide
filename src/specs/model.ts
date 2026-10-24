/** What the host returns for the specs of a repository (the camelCase JSON of `harness-specs`). */
export type Status = "draft" | "specified" | "planned" | "building" | "verifying" | "done" | "archived";
export type NextStep = "specify" | "plan" | "implement" | "archive";
export type WarningSeverity = "note" | "warning" | "error";

export interface SpecWarning {
  file: string;
  line: number | null;
  severity: WarningSeverity;
  message: string;
}

export interface CapabilitySummary {
  name: string;
  title: string;
  purpose: string | null;
  requirements: number;
  path: string;
  /** Files the text names that no longer exist: the spec has drifted from the code. */
  warnings: SpecWarning[];
}

export interface ChangeSummary {
  dir: string;
  number: number | null;
  title: string;
  status: Status;
  created: string | null;
  branch: string | null;
  tasksDone: number;
  tasksTotal: number;
  openQuestions: number;
  /** The fixed documents that exist, in reading order. */
  documents: string[];
  taskDocuments: string[];
  nextStep: NextStep | null;
  hint: string | null;
  warnings: SpecWarning[];
}

export interface ArchivedChange {
  dir: string;
  title: string;
}

/** One capability the survey proposed for an existing project (a section of onboarding.md). */
export interface OnboardingEntry {
  /** The folder name under capabilities/. */
  name: string;
  title: string;
  purpose: string;
  paths: string[];
  notes: string;
  /** Whether its spec exists. */
  written: boolean;
}

export interface SpecsOverview {
  /** The specs root, relative to the repository. */
  root: string;
  exists: boolean;
  project: boolean;
  projectWarnings: SpecWarning[];
  capabilities: CapabilitySummary[];
  /** The survey's capability list; null when there is none. */
  onboarding: OnboardingEntry[] | null;
  changes: ChangeSummary[];
  archive: ArchivedChange[];
  warnings: SpecWarning[];
}

export interface SpecTask {
  id: string;
  title: string;
  done: boolean;
  line: number;
  requirements: string[];
  criteria: string[];
  after: string[];
  instructions: string;
}

export type BranchOutcome = { kind: "created"; name: string } | { kind: "skipped"; reason: string };

export interface CreatedChange {
  dir: string;
  files: string[];
  /** Absent when no branch was asked for. */
  branch: BranchOutcome | null;
}

export interface NewChangeRequest {
  title: string;
  description: string;
  /** `YYYY-MM-DD`, from this machine's clock. */
  date: string;
  branch: boolean;
}

export type SpecStep = "specify" | "plan" | "implement" | "start" | "capability";

export interface SpecDocumentInput {
  name: string;
  text: string;
}

/** What recording a run wrote and what the checks found afterwards. */
export interface SpecRecorded {
  written: string[];
  status: Status;
  warnings: SpecWarning[];
}

/** The plans an Implement run starts from (JSON for the task queue). */
export interface SpecQueuePlans {
  full: unknown;
  remaining: unknown;
  totalTasks: number;
  remainingTasks: number;
}

export interface SpecTaskResult {
  id: string;
  built: string;
  review: string;
}

export interface SpecVerification {
  summary: string;
  criteria: { id: string; status: string; evidence: string; how_to_test: string }[];
}

export interface SpecProgress {
  tasks: SpecTaskResult[];
  verification: SpecVerification | null;
  passed: boolean;
}

export interface SpecProgressRecorded {
  ticked: string[];
  status: Status;
  warnings: SpecWarning[];
}

/** What archiving a change did. */
export interface SpecArchived {
  archivedDir: string;
  /** Capabilities that were created or changed. */
  merged: string[];
  /** Requirements without a `Capability:` line, which were merged nowhere. */
  unmerged: string[];
}

export type ForeignKind = "open_spec" | "spec_kit";

/** An OpenSpec or Spec Kit folder found in the repository. */
export interface ForeignSource {
  source: ForeignKind;
  path: string;
  capabilities: number;
  changes: number;
  /** Finished changes that are not imported. */
  archived: number;
}

export interface ExportReport {
  /** Files and folders that were written. */
  written: string[];
  /** What was left alone, or has no equivalent in the target, and why. */
  skipped: string[];
}

export interface ImportReport {
  project: boolean;
  capabilities: string[];
  changes: string[];
  /** What was left alone and why. */
  skipped: string[];
}
