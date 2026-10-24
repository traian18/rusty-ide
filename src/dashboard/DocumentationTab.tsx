import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Activity, BookText, ClipboardList, FolderGit2, LayoutGrid, Loader2, RefreshCw } from "lucide-react";

import { navigationRequest } from "../architecture/navigation";
import { useRepository } from "../architecture/useRepository";
import { CompactSelect } from "../components/CompactSelect";
import { repositoryOptions } from "../components/git/repositoryOptions";
import { Button, Callout } from "../components/ui";
import { useWorkspaceStore } from "../store";
import { CodeHealthPage, healthClient, type HealthClient } from "../health";
import { specsClient as defaultSpecsClient, SpecsPage, type SpecsClient } from "../specs";
import { docsClient as defaultDocsClient, GuideView, ModelSwitches, WorkspacePanel, type DocsClient } from "../wiki";
import { dashboardClient, type DashboardClient } from "./client";
import { useDashboard, type DashboardPage } from "./dashboardState";
import { FileDrawer } from "./FileDrawer";
import { FilesPage } from "./FilesPage";
import styles from "./Dashboard.module.css";

type OpenTab = (tab: ReturnType<typeof navigationRequest>["tab"]) => void;

export interface DocumentationTabProps {
  /** Injected in tests; the app uses the Tauri clients. */
  client?: DashboardClient;
  healthClient?: HealthClient;
  docsClient?: DocsClient;
  specsClient?: SpecsClient;
  /** Overrides the repository root from the store (tests). */
  root?: string;
  openFile?: OpenTab;
  /** Starts a chat with a prompt (Hand to agent); absent hides the action. */
  handToAgent?(prompt: string, files: string[]): void;
}

const PAGES: { id: DashboardPage; label: string; icon: typeof LayoutGrid }[] = [
  { id: "docs", label: "Project documentation", icon: BookText },
  { id: "specs", label: "Specs", icon: ClipboardList },
  { id: "health", label: "Code health", icon: Activity },
  { id: "files", label: "Files", icon: LayoutGrid },
];

/** Everything about one repository a developer reads: its documentation and specs, its code health, and how its files are distributed. */
export function DocumentationTab({ client = dashboardClient, healthClient: health = healthClient, docsClient = defaultDocsClient, specsClient = defaultSpecsClient, root: rootOverride, openFile, handToAgent }: DocumentationTabProps) {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const repositories = useWorkspaceStore((state) => state.repositories);
  const activeRepositoryId = useWorkspaceStore((state) => state.activeRepositoryId);
  const setActiveRepositoryId = useWorkspaceStore((state) => state.setActiveRepositoryId);
  const discoverRepositories = useWorkspaceStore((state) => state.discoverRepositories);

  useEffect(() => {
    if (rootOverride === undefined && rootPath && repositories.length === 0) void discoverRepositories();
    // Discovery runs once per workspace; the sidebar triggers it too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  const active = repositories.find((repository) => repository.id === activeRepositoryId) ?? repositories[0] ?? null;
  const root = rootOverride ?? active?.worktreePath ?? rootPath;
  if (!root) {
    return (
      <div className={styles.centered}>
        <p>Open a workspace to read its documentation.</p>
      </div>
    );
  }
  const options = rootOverride === undefined && rootPath ? repositoryOptions(repositories, rootPath) : [];
  const selector =
    options.length > 1 ? (
      <CompactSelect
        id="dashboard-repository"
        value={root}
        onChange={(path) => setActiveRepositoryId(repositories.find((repository) => repository.worktreePath === path)?.id ?? null)}
        options={options}
        placeholder="Select repository"
        icon={<FolderGit2 size={10} className="flex-shrink-0 mr-1" />}
      />
    ) : null;
  return (
    <Claimed
      key={root}
      root={root}
      client={client}
      health={health}
      docs={docsClient}
      specs={specsClient}
      selector={selector}
      workspace={rootOverride === undefined && options.length > 1 ? { root: rootPath!, open: setActiveRepositoryId } : null}
      openFile={openFile ?? ((tab) => openTab(tab))}
      handToAgent={handToAgent}
    />
  );
}

interface ShellProps {
  root: string;
  client: DashboardClient;
  health: HealthClient;
  docs: DocsClient;
  specs: SpecsClient;
  selector: ReactNode;
  /** The workspace folder and how to open one of its repositories, when it holds several. */
  workspace: { root: string; open(id: string): void } | null;
  openFile: OpenTab;
  handToAgent?: DocumentationTabProps["handToAgent"];
}

function Claimed(props: ShellProps) {
  const claimed = useDashboard((state) => state.root === props.root);
  useLayoutEffect(() => {
    if (!claimed) useDashboard.getState().claimRoot(props.root);
  }, [claimed, props.root]);
  return claimed ? <Shell {...props} /> : null;
}

function Shell({ root, client, health, docs, specs, selector, workspace, openFile, handToAgent }: ShellProps) {
  const page = useDashboard((state) => state.page);
  const setPage = useDashboard((state) => state.setPage);
  const selected = useDashboard((state) => state.selected);
  const select = useDashboard((state) => state.select);
  const session = useRepository(root, client);
  const ready = session.status === "ready";
  const [showRepositories, setShowRepositories] = useState(false);
  const open = (file: string, line?: number, stale?: boolean) => openFile(navigationRequest(root, { file, line, stale }).tab);

  let body: ReactNode;
  if (showRepositories && workspace) {
    body = (
      <div className={styles.page}>
        <WorkspacePanel
          client={docs}
          root={workspace.root}
          activeRoot={root}
          revision={session.revision}
          onOpen={(repository) => {
            workspace.open(repository.id);
            setShowRepositories(false);
          }}
          onIndexed={() => void session.checkFreshness()}
        />
      </div>
    );
  } else if (page === "specs") {
    // Specs are plain files: they show before (and without) the repository being analyzed.
    body = <SpecsPage client={specs} root={root} openFile={(path, line) => open(path, line)} />;
  } else if (session.status === "opening") {
    body = (
      <div className={styles.centered} role="status">
        <Loader2 className="animate-spin" aria-hidden /> Loading repository…
      </div>
    );
  } else if (session.status === "error") {
    body = (
      <div className={styles.centered}>
        <Callout variant="danger">{session.error?.message ?? "The repository could not be opened."}</Callout>
        <Button onClick={session.retry}>Try again</Button>
      </div>
    );
  } else if (!ready) {
    body = (
      <div className={styles.centered}>
        <p>This repository has not been analyzed yet. Analyzing reads the files and the Git history on this machine; no model is used.</p>
        <Button variant="primary" onClick={() => void session.refresh()}>
          Analyze
        </Button>
      </div>
    );
  } else if (page === "health") {
    body = <CodeHealthPage client={health} root={root} revision={session.revision} openFile={open} />;
  } else if (page === "docs") {
    body = <GuideView client={docs} root={root} revision={session.revision} openCitation={(citation, stale) => open(citation.file, citation.start_line, stale)} />;
  } else {
    body = (
      <>
        <div className={styles.page}>
          <FilesPage client={client} root={root} revision={session.revision} />
        </div>
        {selected ? (
          <FileDrawer
            key={selected}
            client={client}
            root={root}
            file={selected}
            revision={session.revision}
            onClose={() => select(null)}
            onOpenFile={open}
            onSelectFile={select}
            handToAgent={handToAgent}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header} role="toolbar" aria-label="Documentation">
        {selector}
        {workspace ? (
          <Button variant={showRepositories ? "secondary" : "ghost"} aria-pressed={showRepositories} onClick={() => setShowRepositories((shown) => !shown)}>
            Repositories
          </Button>
        ) : null}
        <span className={styles.spacer} />
        <ModelSwitches />
        {session.refreshing ? (
          <Loader2 size={14} className="animate-spin" aria-label="Analyzing" />
        ) : (
          <Button variant={ready ? "ghost" : "primary"} icon={<RefreshCw size={14} />} onClick={() => void session.refresh()}>
            {ready ? "Refresh" : "Analyze"}
          </Button>
        )}
      </div>
      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Documentation pages">
          {PAGES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={styles.navItem}
              aria-current={page === id && !showRepositories ? "page" : undefined}
              onClick={() => {
                setShowRepositories(false);
                setPage(id);
              }}
            >
              <Icon size={14} aria-hidden /> {label}
            </button>
          ))}
        </nav>
        {body}
      </div>
    </div>
  );
}
