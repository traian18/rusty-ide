# Architecture feature: how it fits together

The architecture feature gives a developer a visual, navigable model of a repository: its packages and directory groups, source files and imports, framework relationships, findings, and (when available) Git history. It exists to make repository structure and dependency relationships easier to explore than by reading files one at a time. It is analysis and navigation, not an editor or a source-of-truth for the code: the Rust-side repository analysis produces snapshots; the feature presents those snapshots and keeps a separate user layer for layout, preferences, and notes.

## Where it enters the application

The feature is exposed as the `architecture` canvas tab in `src/tabs/views.tsx`. That registry renders `ArchitectureTab` from `src/features/architecture/ui/index.ts`; the tab framework supplies the surrounding workspace/tab lifecycle. Opening a workspace gives the feature its repository context, while `src/components/shell/repositoryIndexingCoordinator.ts` also connects repository indexing and refresh work to the architecture API. The architecture feature's `index.ts` is its small public logic API (`navigationRequest`, `tauriClient`, and related types); other features should use that boundary rather than importing its internal modules.

The architecture view also connects back out: `navigation.ts` converts a root-relative analysis location to the application's file-tab request. The UI opens that tab through the workspace store's `openTab`. When an analysis line is stale, it deliberately opens the file at the top and shows a notice instead of sending the user to a potentially incorrect line. `ArchitectureTab` shares the selected repository with the Git sidebar and uses the common workspace store; repository-specific architecture view state is keyed by root so switching repositories does not leak selection or layout.

## Main flow

```text
IDE tab registry
  -> ArchitectureTab / ArchitectureWorkspace
  -> useRepository (open, refresh, cancel, close; freshness and findings badges)
  -> useViewData (fetch level or drill-down data)
  -> pure view transforms (filter, aggregate, graph model)
  -> asynchronous layout
  -> Canvas + toolbar, summary, breadcrumb and side panels
  -> navigationRequest -> workspace file tab

React hooks and UI -> ArchitectureClient -> Tauri commands/events -> Rust repository analysis
                                    |
                                    +-> repository-scoped saved user document
```

`client.ts` is the sole Tauri boundary for this feature. Its `ArchitectureClient` interface describes repository operations, graph and finding queries, Git/freshness queries, saved-state access, and workspace/analysis event subscriptions. The default implementation translates those methods to Tauri `invoke` commands and event listeners, normalizing rejected commands to `RepositoryError`. UI hooks accept the interface as a dependency, which lets tests provide a fake client without invoking native code.

The native repository commands return the contracts declared in `model.ts`. These are serialized Rust/core-facing models (including snake_case fields); keeping them in a pure TypeScript module makes the contract usable without React, the store, or Tauri. An `open` result includes repository discovery and snapshot metadata, optional Git and finding summaries, and build time. The client exposes focused follow-up queries for architecture levels, group graphs, imports, framework relations, findings/explanations, Git file facts, and freshness. Refresh replaces the source-derived analysis; subscriptions allow the UI to notice workspace file changes and background analysis updates.

## Data and rendering responsibilities

- **Repository session — `ui/useRepository.ts`:** opens/closes the selected root, refreshes or cancels analysis, tracks status/revision and freshness, and provides finding badges and stage errors.
- **View-data loading — `ui/useViewData.ts` and `ui/useAsyncData.ts`:** fetches data for the current focus and revision. The view is hierarchical: the overview shows aggregated levels; opening a group drills into its file graph. The trail determines the focus and breadcrumb.
- **Graph preparation — `levels.ts`, `levelGraph.ts`, `aggregate.ts`, `graphModel.ts`:** select levels, filter results, aggregate nodes, cap and thin edges, map server data to canvas nodes/edges, and form drill-down graphs. These modules are largely pure and have focused unit tests.
- **Layout and drawing — `ui/useLevelLayout.ts`, `layout.ts`, `layoutElk.ts`, `elkLoader.ts`, `ui/Canvas.tsx`, `ui/nodes.tsx`, and `ui/edges.tsx`:** compute positions asynchronously (with a simpler fallback) and render the interactive graph. Layout is kept separate from repository analysis.
- **Feature composition — `ui/ArchitectureTab.tsx`:** ties the hooks and pure transformations together, then composes the toolbar, summary, breadcrumb, canvas, legend, banners, and side panel. The side panel selects inspectors and findings, framework relations, Git facts, or notes according to the current view and selection.
- **Navigation — `navigation.ts`:** centralizes path joining and stale-line behavior for links from findings and graph details to editor tabs.

## Analysis versus user-owned data

Keep these two kinds of state distinct. The repository snapshot, findings, framework relations, and Git facts are derived from the repository and can be replaced by refresh. The user document is managed by `persistence.ts` and `ui/useUserLayer.ts`: it stores per-view node positions, view preferences, and notes keyed to stable node identities. It is loaded and validated independently; malformed or incompatible pieces are skipped with a warning. Refresh does not rewrite it. Notes attached to nodes that disappeared become orphaned rather than being silently deleted, and layout positions can be retained when the current graph does not show those nodes.

`viewState.ts` holds the interactive view (trail, selection, filters, panel, viewport and graph controls) beyond the tab being visible. The workspace claims that state for a repository root. Persistent user preferences are synchronized to the saved document, while transient navigation and viewport interaction remain view state. Stable keys and `identity.ts` keep persisted references from accidentally targeting unrelated nodes.

## Finding your way around

Start here, in this order:

1. `ui/ArchitectureTab.tsx` — the composition root and end-to-end UI flow.
2. `client.ts` and `model.ts` — the native boundary and data contracts.
3. `ui/useRepository.ts`, `ui/useViewData.ts`, and `ui/useUserLayer.ts` — loading, revisions, refresh, and saved user state.
4. `aggregate.ts`, `levelGraph.ts`, and `graphModel.ts` — how analysis results become graph data.
5. `ui/Canvas.tsx` and `ui/SidePanel.tsx` — the interactive presentation and detail views.
6. `navigation.ts` and `persistence.ts` — editor integration and durable user data.

The folder has 61 TypeScript files, with most UI components and hooks under `ui/`. Its tests sit alongside the pure model/graph/layout modules and include `ui/ArchitectureTab.test.tsx` and `ui/ArchitectureLevels.test.tsx` for rendered behavior. The layering rules are documented in `src/features/README.md` and exercised by `layering.test.ts`: keep native calls in the client boundary, keep domain transformations testable, and keep React in `ui/`.

## Connections at a glance

- **Rust/core analysis:** Tauri repository commands provide snapshots, graph/query pages, findings, freshness and Git facts; the TypeScript client adapts those commands.
- **Workspace and tabs:** workspace repository selection determines the root; the tab registry hosts the feature; workspace `openTab` opens source files from graph/finding locations.
- **Git feature:** repository choices are shared through `repositoryOptions`; architecture can show Git summaries and per-file history facts when available.
- **Background indexing:** the shell coordinator uses the architecture public API while coordinating repository indexing and refresh.
- **Other analysis features:** dashboard, wiki and health surfaces use architecture exports for repository data, while feature boundaries keep their integration explicit.

This separation is useful when changing the feature: put Tauri command details in `client.ts`, serialized contracts in `model.ts`, deterministic graph decisions in pure modules, lifecycle and data fetching in hooks, user-owned persistence in the user layer, and rendering in `ui/`. Add or update the focused tests at the same boundary as the behavior being changed.
