# Features

Each folder here is one feature of the IDE: git, the agent chat, workflows, and so on. Everything
a feature needs lives in its own folder, and it has the same shape everywhere.

| File | Holds | May import |
|---|---|---|
| `ui/` | React views (`.tsx`) and hooks (`useX.ts`) | its own feature, `lib/`, other features' `index.ts` |
| `service.ts` | orchestration: calls the client, updates state, applies the rules | `client`, `state`, `model`, `lib/` (not `lib/ui`), other features' `index.ts` |
| `state.ts` | the feature's zustand slice or store | `model`, `lib/`; never `src/store.ts` |
| `client.ts` | the feature's Tauri commands, behind an exported interface | `@tauri-apps/*`, `model` |
| `model.ts` | types and pure functions, with no side effects | `lib/` (not `lib/ui`) |
| `index.ts` | the public API for logic and types; other code imports only this | the feature's own files |
| `ui/index.ts` | the public API for views and view hooks, kept apart so non-UI code never loads React | the feature's own `ui/` |

Large features split `service.ts`, `state.ts` or `model.ts` into folders with the same names.
Create only the files a feature needs.

`index.ts` must stay free of the store and of React: the harness and Node tests import it. A service
that needs the store is wired in `ui/` (for example `explorer/ui/explorerService.ts`), and a view
hook that must not run at import time (for example the editor's Monaco theme) runs on first render.

## The flow

A view calls a hook in `ui/`. The hook reads `state` and calls the `service`. The service calls the
`client` and uses the `model`. Views never call `invoke` and never hold business rules.

```ts
// features/git/client.ts (illustrative): the one place that names the Tauri commands
export interface GitClient {
  status(root: string): Promise<GitStatus>;
}
export const gitClient: GitClient = {
  status: (root) => invoke<GitStatus>("git_status", { root }),
};
```

## Rules

These are checked by [`../boundaries.test.ts`](../boundaries.test.ts) on every test run:

- **B1:** only `client.ts` files, `lib/platform/` and the harness call `@tauri-apps/*`.
- **B2:** a feature reaches another feature only through its `index.ts` or `ui/index.ts`.
- **B3:** `lib/` never imports `features/`, `app/` or `harness/`; `state.ts` never imports the store.
- **B4:** React and `.tsx` stay in `ui/`.
- **B5:** `.tsx` files stay under 300 lines and `.ts` files under 400.

Known violations are listed in [`../boundaryAllowlist.ts`](../boundaryAllowlist.ts). The test fails
when a listed file is fixed, so remove its entry in the same change.
