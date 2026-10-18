import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { repositoryOptions } from "../components/git/repositoryOptions";
import { Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { Button, Callout } from "../components/ui";
import { aggregateLevel } from "./aggregate";
import { NoticesMenu, type BannersProps } from "./Banners";
import { Breadcrumb } from "./Breadcrumb";
import { Canvas } from "./Canvas";
import { tauriClient, type ArchitectureClient } from "./client";
import { describeFreshness, staleSummary } from "./freshness";
import { groupDrillGraph, groupViewKey, type CanvasGraph, type ViewFilter } from "./graphModel";
import { Legend } from "./Legend";
import { filterLevelView, levelCanvas } from "./levelGraph";
import { focusOf, LEVEL_CAP, levelViewKey, MAX_EDGES_DRAWN } from "./levels";
import { SummaryStrip } from "./SummaryStrip";
import { useLevelLayout, type LayoutEngineLoader } from "./useLevelLayout";
import type { NodeKey } from "./identity";
import { navigationRequest, type NavigationTarget } from "./navigation";
import { addNote, deleteNote, editNote, withLayout } from "./persistence";
import type { GroupSummary, LevelChild } from "./model";
import { SidePanel } from "./SidePanel";
import { Toolbar, type RepositoryChoice } from "./Toolbar";
import { useRepository } from "./useRepository";
import { useUserLayer } from "./useUserLayer";
import { useViewData } from "./useViewData";
import { useArchitectureView, type ArchitectureViewState } from "./viewState";
import styles from "./Architecture.module.css";

const CLOCK_TICK_MS = 30_000;

export interface ArchitectureTabProps {
  /** Injected in tests; the app uses the Tauri client. */
  client?: ArchitectureClient;
  /** Overrides the workspace root from the store (tests). */
  root?: string;
  /** Opens a file tab; defaults to the workspace store's `openTab`. */
  openFile?: (tab: ReturnType<typeof navigationRequest>["tab"]) => void;
  newId?: () => string;
  /** Loads the layout engine; tests pass one that needs no worker. */
  loadLayoutEngine?: LayoutEngineLoader;
}

const defaultNewId = () => `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function ArchitectureTab({ client = tauriClient, root: rootOverride, openFile, newId = defaultNewId, loadLayoutEngine }: ArchitectureTabProps) {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const repositories = useWorkspaceStore((state) => state.repositories);
  const activeRepositoryId = useWorkspaceStore((state) => state.activeRepositoryId);
  const setActiveRepositoryId = useWorkspaceStore((state) => state.setActiveRepositoryId);
  const discoverRepositories = useWorkspaceStore((state) => state.discoverRepositories);

  // A workspace folder can hold several repositories; the Git sidebar and this tab share the choice.
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
        <p>Open a workspace to see its architecture.</p>
      </div>
    );
  }
  const choices = rootOverride === undefined && rootPath ? repositoryOptions(repositories, rootPath) : [];
  return (
    // Keyed by repository so view state, layout and notes never leak from one repository to the next.
    <ArchitectureWorkspace
      key={root}
      client={client}
      root={root}
      openFile={openFile ?? ((tab) => openTab(tab))}
      newId={newId}
      loadLayoutEngine={loadLayoutEngine}
      repositories={{ options: choices, active: root, onChange: (path) => setActiveRepositoryId(repositories.find((repository) => repository.worktreePath === path)?.id ?? null) }}
    />
  );
}

type WorkspaceProps = Parameters<typeof WorkspaceBody>[0];

/**
 * Keeps the view (level, selection, filters, pan and zoom) in a store that outlives the tab being
 * on screen, so switching away and back finds it exactly as it was. A different repository starts afresh.
 */
function ArchitectureWorkspace(props: WorkspaceProps) {
  const claimed = useArchitectureView((state) => state.root === props.root);
  useLayoutEffect(() => {
    if (!claimed) useArchitectureView.getState().claimRoot(props.root);
  }, [claimed, props.root]);
  return claimed ? <WorkspaceBody {...props} /> : null;
}

function WorkspaceBody({ client, root, openFile, newId, loadLayoutEngine, repositories }: { client: ArchitectureClient; root: string; openFile: NonNullable<ArchitectureTabProps["openFile"]>; newId: () => string; loadLayoutEngine?: LayoutEngineLoader; repositories: RepositoryChoice }) {
  const view = useArchitectureView();
  const session = useRepository(root, client);
  const snapshot = session.open?.snapshot ?? null;
  const layer = useUserLayer(root, client, { hasSnapshot: snapshot !== null, revision: session.revision });
  const focus = focusOf(view.trail);
  const data = useViewData(root, client, { enabled: session.status === "ready", revision: session.revision, focus });
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Restore the saved view once, and keep the saved view in step with the controls.
  const { loaded, document } = layer;
  useEffect(() => {
    if (loaded) view.hydrate(document.view);
    // Hydrating once per load is the point; the controls write back below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  useEffect(() => {
    if (!loaded) return;
    layer.update((current) =>
      current.view.importKind === view.importKind && current.view.colorMode === view.colorBy && current.view.edgeShare === view.edgeCoverage && current.view.spacing === view.spacing && current.view.frameworks === view.showFrameworks
        ? current
        : { ...current, view: { importKind: view.importKind, colorMode: view.colorBy, edgeShare: view.edgeCoverage, spacing: view.spacing, frameworks: view.showFrameworks } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, view.importKind, view.colorBy, view.edgeCoverage, view.spacing, view.showFrameworks]);

  const filter: ViewFilter = { search: view.search, importKind: view.importKind, onlyWithFindings: view.onlyWithFindings };
  const noted = useMemo(() => new Set<NodeKey>(document.notes.map((note) => note.node)), [document.notes]);
  // What is shown follows from the trail: the focus's folders, or its files when it has no folders.
  const drillData = data.drill && data.drill.group.id === focus ? data.drill : null;
  const levelsActive = drillData === null;
  const levelKey = levelViewKey(view.trail);
  const viewKey = drillData ? groupViewKey(drillData.group.id) : levelKey;
  const saved = document.layouts[viewKey];
  const up = () => view.goTo(view.trail.length - 1);

  // Levelled view: filter, rank and fold, thin the edges, then lay out (asynchronously).
  const levelData = levelsActive && data.levelView && data.levelView.focus === focus ? data.levelView : null;
  const levelWork = useMemo(() => {
    if (!levelData) return null;
    const filtered = filterLevelView(levelData, session.badges, { search: view.search, onlyWithFindings: view.onlyWithFindings });
    const aggregated = aggregateLevel(filtered.view, { cap: LEVEL_CAP, coverage: view.edgeCoverage, edgeCap: MAX_EDGES_DRAWN, importKind: view.importKind, frameworks: view.showFrameworks });
    const canvas = levelCanvas(aggregated, session.badges, noted, { viewKey: levelKey, colorBy: view.colorBy, frame: false, frameLabel: "" });
    return { aggregated, canvas, hidden: filtered.hidden };
  }, [levelData, session.badges, noted, levelKey, view.search, view.onlyWithFindings, view.edgeCoverage, view.importKind, view.colorBy, view.showFrameworks]);
  const laidOut = useLevelLayout(levelWork?.canvas ?? null, saved, view.spacing, loadLayoutEngine);

  const flatGraph = useMemo(() => {
    const positions = saved ?? {};
    if (drillData) return groupDrillGraph(drillData, session.badges, noted, positions, filter, view.showFrameworks);
    return null;
    // `filter` is rebuilt every render from the same primitives listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillData, session.badges, noted, saved, view.search, view.importKind, view.onlyWithFindings, view.showFrameworks]);
  const graph = useMemo(
    () => (levelsActive ? (laidOut.graph ? { ...laidOut.graph, hiddenByFilter: levelWork?.hidden ?? 0 } : null) : flatGraph),
    [levelsActive, laidOut.graph, levelWork, flatGraph],
  );

  const groups = useMemo(() => {
    const map = new Map<string, GroupSummary>();
    for (const node of levelWork?.aggregated.nodes ?? []) {
      map.set(node.id, { id: node.id, kind: node.kind, label: node.label, basis: node.basis ?? "derived", explanation: node.explanation, member_count: node.file_count, involves_type_only: false });
    }
    if (drillData) map.set(drillData.group.id, drillData.group);
    return map;
  }, [drillData, levelWork]);
  const openGroup = (groupId: string) => view.open({ id: groupId, label: groups.get(groupId)?.label ?? groupId });
  const openComponent = (child: LevelChild) => view.open({ id: child.id, label: child.label });

  const navigate = (target: NavigationTarget) => {
    const request = navigationRequest(root, target);
    openFile(request.tab);
    setNotice(request.notice);
  };
  const report = describeFreshness(session.open?.built_at_ms ?? null, now, session.freshness?.changed ?? [], session.freshness?.missing ?? []);
  const truncation = drillData?.truncation ?? (data.levelView?.nodes_truncated ? "node_limit" : data.levelView?.edges_truncated ? "edge_limit" : "none");

  const noticeProps: BannersProps = {
    snapshot,
    git: session.open?.git ?? null,
    findings: session.open?.findings?.summary ?? null,
    stale: report.state === "stale",
    staleText: staleSummary(report),
    truncation,
    loadError: data.error,
    refreshError: session.refreshError,
    stageErrors: session.stageErrors,
    documentWarning: layer.warning,
    navigationNotice: notice,
    onRefresh: () => void session.refresh(),
    onLeaveDrill: up,
    frameworks: snapshot?.frameworks ?? null,
  };
  return (
    <div className={styles.root}>
      <Toolbar
        view={view}
        drillLabel={drillData ? (view.trail.at(-1)?.label ?? drillData.group.label) : null}
        onUp={up}
        builtAtMs={session.open?.built_at_ms ?? null}
        freshness={session.freshness}
        refreshing={session.refreshing}
        canRefresh={session.status !== "opening"}
        findingsTotal={session.open?.findings?.summary.total ?? 0}
        frameworkRelations={snapshot?.frameworks.relations ?? 0}
        now={now}
        onRefresh={() => void session.refresh()}
        onCancel={() => void session.cancelRefresh()}
        notices={<NoticesMenu {...noticeProps} />}
        repositories={repositories}
      />
      {snapshot ? (
        <>
          <SummaryStrip
            root={root}
            client={client}
            revision={session.revision}
            snapshot={snapshot}
            findings={session.open?.findings?.summary ?? null}
            cycles={data.levelView?.cycle_groups ?? 0}
            onOpenFindings={() => view.setPanel("findings")}
          />
          <Breadcrumb trail={view.trail} topLabel={root.split("/").filter(Boolean).pop() ?? root} onGo={view.goTo} />
        </>
      ) : null}
      <div className={styles.body}>
        <div className={styles.canvas}>
          <CanvasArea session={session} data={{ ...data, loading: data.loading || (levelsActive && laidOut.computing) }} graph={graph} view={view} snapshotFiles={snapshot?.files ?? 0} />
          {graph && graph.hiddenByFilter > 0 ? <div className={styles.hiddenNotice}>{graph.hiddenByFilter} hidden by filters</div> : null}
          {levelsActive && levelWork && (levelWork.aggregated.foldedCount > 0 || levelWork.aggregated.hiddenEdges > 0 || laidOut.engine === "fallback") ? (
            <div className={styles.hiddenNotice} role="status">
              {[
                levelWork.aggregated.foldedCount ? `${levelWork.aggregated.foldedCount} less connected nodes folded` : "",
                levelWork.aggregated.hiddenEdges ? `${levelWork.aggregated.hiddenEdges} of ${levelWork.aggregated.totalEdges} weaker edges hidden` : "",
                laidOut.engine === "fallback" ? "simple layout in use" : "",
              ].filter(Boolean).join(" · ")}
            </div>
          ) : null}
          {graph && graph.nodes.length ? (
            <CanvasView graph={graph} view={view} layer={layer} onOpenGroup={openGroup} onOpenChild={openComponent} />
          ) : null}
          {levelsActive && graph && graph.nodes.length && levelWork ? <Legend colorBy={view.colorBy} languages={levelWork.canvas.legend} frameworkOn={view.showFrameworks} /> : null}
        </div>
        <SidePanel
          root={root}
          client={client}
          revision={session.revision}
          panel={view.panel}
          onPanel={view.setPanel}
          selection={view.selection}
          groups={groups}
          badges={session.badges}
          drill={drillData}
          hasGit={session.open?.git != null}
          hasFrameworks={(snapshot?.frameworks.relations ?? 0) > 0}
          notes={document.notes}
          orphaned={layer.orphaned}
          onOpenGroup={openGroup}
          onNavigate={navigate}
          onAddNote={(node, text) => layer.update((current) => addNote(current, node, text, Date.now(), newId()))}
          onEditNote={(id, text) => layer.update((current) => editNote(current, id, text, Date.now()))}
          onDeleteNote={(id) => layer.update((current) => deleteNote(current, id))}
        />
      </div>
    </div>
  );
}

function CanvasView({ graph, view, layer, onOpenGroup, onOpenChild }: { graph: CanvasGraph; view: ArchitectureViewState; layer: ReturnType<typeof useUserLayer>; onOpenGroup(groupId: string): void; onOpenChild(child: LevelChild): void }) {
  return (
    <Canvas
      graph={graph}
      selection={view.selection}
      onSelect={(key) => {
        view.select(key);
        if (key) view.setPanel("inspector");
      }}
      onOpenGroup={onOpenGroup}
      onOpenChild={onOpenChild}
      viewport={view.viewports[graph.viewKey]}
      onViewport={view.setViewport}
      onMoved={(viewKey, positions) => layer.update((current) => withLayout(current, viewKey, positions))}
    />
  );
}

/** What fills the canvas area when there is no graph to draw. */
function CanvasArea({ session, data, graph, view, snapshotFiles }: { session: ReturnType<typeof useRepository>; data: ReturnType<typeof useViewData>; graph: CanvasGraph | null; view: ArchitectureViewState; snapshotFiles: number }) {
  if (session.status === "opening") {
    return (
      <div className={styles.centered} role="status">
        <Loader2 className="animate-spin" aria-hidden /> Loading repository…
      </div>
    );
  }
  if (session.status === "error") {
    return (
      <div className={styles.centered}>
        <Callout variant="danger">
          <strong>Could not open the repository.</strong> {session.error?.message}
        </Callout>
        <Button onClick={session.retry}>Try again</Button>
      </div>
    );
  }
  if (session.status === "no-snapshot") {
    return (
      <div className={styles.centered}>
        <p>This workspace has not been analyzed yet.</p>
        <p className={styles.muted}>Analysis reads your source files locally to find packages, imports, and cycles. It never runs your code.</p>
        <Button variant="primary" loading={session.refreshing} onClick={() => void session.refresh()}>
          Analyze repository
        </Button>
      </div>
    );
  }
  if (snapshotFiles === 0) {
    return (
      <div className={styles.centered}>
        <p>No supported source files were found.</p>
        <p className={styles.muted}>Rust, TypeScript, Java, Kotlin, Python, C#, C, C++, PHP, Go and JavaScript files are analyzed.</p>
      </div>
    );
  }
  if (data.error && !graph) {
    return (
      <div className={styles.centered}>
        <Callout variant="danger">
          <strong>Could not load this view.</strong> {data.error.message}
        </Callout>
        {view.trail.length ? <Button onClick={() => view.goTo(view.trail.length - 1)}>Back</Button> : null}
      </div>
    );
  }
  if (data.loading && !graph) {
    return (
      <div className={styles.centered} role="status">
        <Loader2 className="animate-spin" aria-hidden /> Loading view…
      </div>
    );
  }
  if (graph && graph.nodes.length === 0) {
    return (
      <div className={styles.centered}>
        <p>{graph.hiddenByFilter > 0 ? "Nothing matches the current filters." : "Nothing to show here."}</p>
        {graph.hiddenByFilter > 0 ? (
          <Button
            onClick={() => {
              view.setSearch("");
              view.setOnlyWithFindings(false);
              view.setImportKind("all");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    );
  }
  return null;
}
