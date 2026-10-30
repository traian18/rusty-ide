import { useCallback, useEffect, useState, type ReactNode } from "react";

import { toRepositoryError } from "../../architecture";
import { Button, Callout } from "../../../lib/ui";
import { useLoad } from "../../dashboard/ui";
import { notify } from "../../notifications";
import type { SpecsClient } from "../client";
import { ChangeView } from "./ChangeView";
import { DocumentView } from "./DocumentView";
import { openSpecBatch, openSpecRun } from "../launchStore";
import { OnboardingCard } from "./OnboardingCard";
import { NewChangeDialog } from "./NewChangeDialog";
import type { CreatedChange, CreatedPart, ForeignKind, SpecArchived, SpecsOverview } from "../model";
import { capabilityRequest, specRequest, startRequest } from "../run";
import { ForeignBanner } from "./ForeignBanner";
import {exportSummary, importSummary, localDate, workspacePrefix} from "../pure";
import { useSpecsView, type Selection } from "../specsState";
import { Warnings } from "./Warnings";
import styles from "./Specs.module.css";
import { WorkspaceRepositoryOffer } from "./SpecsWorkspaceOffer";
import { EmptyState, SpecsNav } from "./SpecsNav";

const RELOAD_DELAY_MS = 400;

export interface SpecsPageProps {
  client: SpecsClient;
  root: string;
  /** Opens a file of the repository (relative path) in the editor. */
  openFile(path: string, line?: number): void;
  /** The workspace, when it holds several repositories: a change can then span them. */
  workspace?: SpecsWorkspace | null;
  /** `workspace`: `root` is the workspace folder and its specs live in `.rusty/specs`, outside every repository. */
  level?: SpecsLevel;
}

/** Whose specs the page shows: one repository's, or the whole workspace's. */
export type SpecsLevel = "repository" | "workspace";

export interface SpecsWorkspace {
  root: string;
  /** The repositories a change can be linked across, with the name each has in the workspace. */
  repositories: { path: string; name: string }[];
  /** Shows the repository at `path` on this page. */
  open(path: string): void;
}

/** The specs of a repository, or of the whole workspace. It reads files only, so it works before the repository is analyzed. */
export function SpecsPage({ client, root, openFile, workspace = null, level = "repository" }: SpecsPageProps) {
  const inWorkspace = level === "workspace";
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = useSpecsView((state) => state.selection);
  const select = useSpecsView((state) => state.select);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  // Another repository starts afresh, unless a linked part was opened in it (`openIn`).
  useEffect(() => useSpecsView.getState().claimRoot(root), [root]);
  // Runs work in the workspace folder, so their requests name paths from there.
  const prefix = workspacePrefix(root, workspace?.root) ?? "";
  const loaded = useLoad(() => (inWorkspace ? client.prepareWorkspace(root).then(() => client.overview(root)) : client.overview(root)), [client, root, revision, inWorkspace]);
  const foreign = useLoad(() => (inWorkspace ? Promise.resolve([]) : client.foreign(root).catch(() => [])), [client, root, revision, inWorkspace]).value ?? [];

  // Files change under the page (an agent, an editor, git): follow them, once things settle.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    client.onChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(reload, RELOAD_DELAY_MS);
    }).then((unlisten) => (live ? (stop = unlisten) : unlisten()));
    return () => {
      live = false;
      clearTimeout(timer);
      stop?.();
    };
  }, [client, reload]);

  const overview = loaded.value;
  if (!overview) {
    return loaded.error ? (
      <div className={styles.centered}>
        <Callout variant="danger">{loaded.error}</Callout>
        <Button onClick={reload}>Try again</Button>
      </div>
    ) : (
      <div className={styles.centered} role="status">
        Loading specs…
      </div>
    );
  }

  const setUp = () =>
    client.init(root).then(reload, (failure) => setError(toRepositoryError(failure).message));
  const importFrom = async (source: ForeignKind) => {
    setError(null);
    try {
      const report = await client.importForeign(root, source, localDate());
      notify("Imported", importSummary(report), "info");
      if (report.changes[0]) select({ kind: "change", dir: report.changes[0] });
      reload();
    } catch (failure) {
      setError(toRepositoryError(failure).message);
    }
  };
  const exportTo = async (target: ForeignKind) => {
    setError(null);
    try {
      notify("Exported", exportSummary(target, await client.exportTo(root, target, localDate())), "info");
      reload();
    } catch (failure) {
      setError(toRepositoryError(failure).message);
    }
  };
  const banner = (
    <>
      {inWorkspace ? <WorkspaceRepositoryOffer client={client} workspace={root} /> : null}
      <ForeignBanner found={foreign} onImport={(source) => void importFrom(source)} />
    </>
  );
  const start = (specsRoot: string) => openSpecRun({ root, change: "", step: "start" }, startRequest(`${prefix}${specsRoot}`));
  const archived = (result: SpecArchived) => {
    select({ kind: "project" });
    reload();
    const merged = result.merged.length ? `Merged into ${result.merged.join(", ")}.` : "No requirement named a capability, so nothing was merged.";
    notify("Change archived", `${merged} Moved to ${result.archivedDir}.`, "info");
  };
  const created = (result: CreatedChange, parts: CreatedPart[] = []) => {
    setCreating(false);
    select({ kind: "change", dir: result.dir });
    reload();
    if (parts.length) notify("Linked change created", linkedSummary(parts), "info");
    else if (result.repositoryBranches?.length) notify("Change created", repositoryBranchSummary(result.repositoryBranches), "info");
    else if (result.branch?.kind === "created") notify("Change created", `Switched to ${result.branch.name}.`, "info");
    else if (result.branch?.kind === "skipped") notify("Change created without a branch", result.branch.reason, "info");
  };

  const body = !overview.exists && !overview.changes.length ? <EmptyState banner={banner} owner={inWorkspace ? "This workspace" : "This repository"} onSetUp={() => void setUp()} onNew={() => setCreating(true)} onStart={() => start(overview.root)} root={overview.root} /> : (
    <div className={styles.body}>
      <SpecsNav overview={overview} selection={selection ?? defaultSelection(overview)} onSelect={select} onNew={() => setCreating(true)} />
      <div className={styles.page}>
        {error ? <Callout variant="danger">{error}</Callout> : null}
        <Content client={client} root={root} prefix={prefix} workspace={workspace} overview={overview} selection={selection ?? defaultSelection(overview)} revision={revision} onChanged={reload} onOpenFile={openFile} onStart={() => start(overview.root)} onArchived={archived} onExport={(target) => void exportTo(target)} banner={banner} />
      </div>
    </div>
  );

  return (
    <>
      {body}
      {creating ? <NewChangeDialog client={client} root={root} workspace={workspace} level={level} onClose={() => setCreating(false)} onCreated={created} /> : null}
    </>
  );
}

/** `Created in ide (0007), core (0003). Every part is on spec/0007-dark-mode.` */
function linkedSummary(parts: CreatedPart[]): string {
  const folders = parts.map((part) => `${part.repository} (${part.dir.split("-")[0]})`).join(", ");
  const branches = parts.map((part) => part.branch).filter((branch) => branch !== null);
  const switched = branches.filter((branch) => branch.kind === "created");
  const skipped = branches.flatMap((branch) => (branch.kind === "skipped" ? [branch.reason] : []));
  const branch = switched[0]?.kind === "created" && switched.length === parts.length ? ` Every part is on ${switched[0].name}.` : skipped.length ? ` Some parts got no branch: ${skipped.join("; ")}.` : "";
  return `Created in ${folders}.${branch}`;
}

/** `ide: on feature/dark; core: skipped (a branch named feature/dark already exists)`. */
function repositoryBranchSummary(branches: NonNullable<CreatedChange["repositoryBranches"]>): string {
  return branches.map(({ repository, outcome }) => `${repository}: ${outcome.kind === "created" ? `on ${outcome.name}` : `no branch (${outcome.reason})`}`).join("; ");
}

/** The first change that is not finished, else the first, else the project. */
function defaultSelection(overview: SpecsOverview): Selection {
  const open = overview.changes.find((change) => change.status !== "done") ?? overview.changes[0];
  return open ? { kind: "change", dir: open.dir } : { kind: "project" };
}

interface ContentProps {
  client: SpecsClient;
  root: string;
  /** The repository's folder in the workspace (`rusty-ide/`), or "". */
  prefix: string;
  workspace: SpecsWorkspace | null;
  overview: SpecsOverview;
  selection: Selection;
  revision: number;
  onChanged(): void;
  onOpenFile(path: string, line?: number): void;
  onStart(): void;
  onArchived(result: SpecArchived): void;
  onExport(target: ForeignKind): void;
  banner: ReactNode;
}

function Content({ client, root, prefix, workspace, overview, selection, revision, onChanged, onOpenFile, onStart, onArchived, onExport, banner }: ContentProps) {
  const base = overview.root;
  if (selection?.kind === "change") {
    const change = overview.changes.find((candidate) => candidate.dir === selection.dir);
    if (change) return <ChangeView client={client} root={root} specsRoot={base} workspace={workspace} change={change} revision={revision} onChanged={onChanged} onOpenFile={onOpenFile} onArchived={onArchived} onRun={(step) => openSpecRun({ root, change: change.dir, step }, specRequest(step, change, `${prefix}${base}`))} />;
  }
  if (selection?.kind === "capability") {
    const capability = overview.capabilities.find((candidate) => candidate.name === selection.name);
    if (capability) {
      return (
        <section aria-label={`Capability ${capability.title}`}>
          <header className={styles.header}>
            <h2 className={styles.title}>{capability.title}</h2>
            <span className={styles.badge}>{capability.requirements} requirements</span>
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={() => onOpenFile(capability.path)}>
              Edit spec.md
            </Button>
          </header>
          <Warnings warnings={capability.warnings} onOpen={onOpenFile} />
          <DocumentView client={client} root={root} path={capability.path} revision={revision} missing="This capability has no spec.md." />
        </section>
      );
    }
  }
  if (selection?.kind === "archived") {
    return (
      <section aria-label="Archived change">
        <DocumentView client={client} root={root} path={`${base}/archive/${selection.dir}/spec.md`} revision={revision} missing="The archived change has no spec.md." />
      </section>
    );
  }
  return (
    <section aria-label="Project">
      <header className={styles.header}>
        <h2 className={styles.title}>Project</h2>
        <span style={{ flex: 1 }} />
        <Button variant={overview.project && overview.capabilities.length ? "secondary" : "primary"} title="A model reads the code, writes or revises the project file and proposes the capabilities as a list to review" onClick={onStart}>
          {overview.onboarding ? "Survey again" : "Onboard this project"}
        </Button>
        <Button variant="ghost" title="Writes these specs in OpenSpec's layout under openspec/. The specs here stay the source; nothing that exists there is overwritten." onClick={() => onExport("open_spec")}>
          Export to OpenSpec
        </Button>
        <Button variant="ghost" title="Writes these specs in Spec Kit's layout (.specify/ and specs/NNN-feature/). The specs here stay the source; nothing that exists there is overwritten." onClick={() => onExport("spec_kit")}>
          Export to Spec Kit
        </Button>
        <Button variant="ghost" onClick={() => onOpenFile(`${base}/project.md`)} disabled={!overview.project}>
          Edit project.md
        </Button>
      </header>
      {banner}
      {overview.onboarding ? (
        <OnboardingCard
          entries={overview.onboarding}
          onWrite={(entry) => openSpecRun({ root, change: entry.name, step: "capability" }, capabilityRequest(entry, `${prefix}${base}`))}
          onWriteRemaining={(entries) => openSpecBatch(entries.map((entry) => ({ run: { root, change: entry.name, step: "capability" as const }, message: capabilityRequest(entry, `${prefix}${base}`) })))}
          onEditList={() => onOpenFile(`${base}/onboarding.md`)}
          onSurveyAgain={onStart}
        />
      ) : null}
      <Warnings warnings={[...overview.projectWarnings, ...overview.warnings]} onOpen={onOpenFile} />
      <DocumentView client={client} root={root} path={`${base}/project.md`} revision={revision} missing="project.md does not exist yet. Use Set up specs, or create it by hand." />
    </section>
  );
}
