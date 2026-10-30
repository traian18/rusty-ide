# Shell architecture

## Purpose

`src/components/shell` is the IDE's **application shell and lifecycle-coordination layer**. It composes the persistent workbench UI and governs the frontend's transition from application launch to a usable workspace. It also starts a few app-wide services whose lifetime follows the running IDE.

It is not the implementation home for the editor, explorer, providers, or background jobs. The shell hosts their UI or starts their coordinators; those features remain implemented in their own folders.

## Where it connects to the application

The React entry point `src/main.tsx` mounts `src/App.tsx`. `App.tsx` assembles the shell in three groups:

- `DevLogBridge` and `GlobalShortcuts` are mounted at app level, outside startup gating.
- `AppBootstrapBoundary` wraps `AppShell` and `StartupDegradedBanner`. It decides whether to show startup UI, the workbench, or a critical-failure state.
- `AlertModal`, `DisclaimerModal`, and `UpdateAvailableModal` remain outside the boundary so they can render independently of bootstrap.

The shell's React components read and update shared application state through `src/store.ts`. The boundary relies on the generic startup executor and types in `src/startup/`; shell-specific startup steps are defined locally because they use the IDE store and Tauri APIs.

## Main components

### `AppShell.tsx` and `AppShell.view.tsx`

`AppShell.tsx` is the stateful controller for the workbench composition. It reads shell state (such as search visibility and drawer state) from the workspace store and owns transient presentation state (such as the tool-execution panel and drawer animation). It handles drawer resizing and passes callbacks and refs to the view.

`AppShell.view.tsx` composes the visible workbench: `Header`, `NavigationRail`, `ContextDrawer`, and `MainWorkspace`. It also hosts feature UI that belongs in the shell layout, including `SearchPalette`, `ToolExecutionPanel`, provider download progress, and the background-process bubble. The actual feature behavior is implemented in their respective feature/component modules.

### `AppBootstrapBoundary.tsx` and `AppBootstrapBoundary.view.tsx`

The boundary owns bootstrap orchestration and presents its state through a view. It starts the ordered startup steps, mirrors startup state from the store, and translates the richer startup result into the boundary's pending/ready/failed display. A critical startup failure blocks the workbench and offers recovery; degraded startup is allowed to proceed and is separately communicated by `StartupDegradedBanner`.

The boundary also handles retry and the option to continue without waiting. The startup runner in `src/startup/runStartup.ts` is the generic executor; this component supplies application-specific steps and lifecycle behavior.

### `startupSteps.ts`

This file defines the shell's actual startup work:

1. Load secure configuration (critical).
2. Restore a saved workspace, if one is pending, after configuration succeeds.

The workspace restoration fetches the directory structure through Tauri and updates the workspace store. The lower-level generic startup types and runner live in `src/startup/`, not in this folder.

### Post-bootstrap coordinators

After the startup run settles, `AppBootstrapBoundary` starts app-wide background work:

- `repositoryIndexingCoordinator.ts` chooses the current repository target and coordinates its structural/documentation index, while also maintaining background-job state from events and an initial query.
- `workspaceFsWatchCoordinator.ts` listens for workspace filesystem changes and follows root-path changes from the store so the explorer's tree can be refreshed.
- The provider coordinator is started from `src/features/providers/ui`; it is consumed by the shell but is not part of this folder.

These coordinators are deliberately separate from the UI components. Their tests sit beside them.

### Other app-level helpers

- `GlobalShortcuts.tsx` installs the application-wide keyboard handler, including navigation, search, drawer and tab actions, and suppression of selected browser/webview shortcuts. It is mounted outside bootstrap so it remains active on startup screens.
- `DevLogBridge.tsx` bridges development logging into the app's logging/diagnostic path; it is likewise mounted at app level.
- `StartupDegradedBanner.tsx` presents the degraded-startup condition without preventing access to the workbench.
- `consoleFormat.ts` formats console data for the logging bridge.

## Lifecycle at a glance

```text
src/main.tsx
  └─ src/App.tsx
       ├─ DevLogBridge                 (app lifetime)
       ├─ GlobalShortcuts              (app lifetime)
       ├─ AppBootstrapBoundary
       │    ├─ pending/startup view
       │    ├─ run startup steps
       │    │    ├─ load secure config
       │    │    └─ restore saved workspace
       │    ├─ on settlement: start provider, filesystem-watch,
       │    │  repository-indexing, and update-check work
       │    └─ when usable: AppShell + StartupDegradedBanner
       └─ alert, disclaimer, and update modals (outside the boundary)
```

The boundary delays showing pending UI briefly to avoid a flash on a fast boot and enforces a minimum visible duration once that UI appears. It also places a ceiling on the startup run and allows the user to continue without waiting. Retry uses the recorded step outcomes to build the work that needs to run again.

## State and responsibility boundaries

- **Shell components** own composition, presentation state, and startup lifecycle.
- **`src/store.ts`** is the shared source of workspace and startup state used by the shell and features.
- **`src/startup/`** owns reusable startup execution primitives and result/state types.
- **Feature folders** own feature-specific UI and behavior; the shell imports them where they belong in the app-wide layout.
- **Tauri/native code** supplies filesystem, configuration, and event capabilities through frontend APIs and adapters. The shell coordinates those calls; it is not the native implementation layer.

## Tests and maintenance map

Focused tests live next to the helper/coordinator they cover:

- `startupSteps.test.ts` — shell startup-step behavior.
- `repositoryIndexingCoordinator.test.ts` — repository indexing target and lifecycle behavior.
- `workspaceFsWatchCoordinator.test.ts` — filesystem-watch coordination.
- `StartupDegradedBanner.test.ts` — degraded-startup presentation logic.
- `consoleFormat.test.ts` — console formatting.

When changing bootstrap ordering or recovery, inspect both `AppBootstrapBoundary.tsx` and `startupSteps.ts`, and keep the generic runner's contract in `src/startup/` in view. When changing workbench composition, start with `AppShell.tsx` and `AppShell.view.tsx`; when changing a coordinator, update its focused test as well.
