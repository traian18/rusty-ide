# rusty-ide

## Purpose
A desktop IDE for developers working in local project folders. It combines workspace and file management, Git, a terminal, repository analysis, and AI-assisted coding workflows. It is broader than a text editor: users can run multi-step agent workflows, review changes, and integrate agent work into the working tree. The desktop backend embeds the agent engine; `rusty-core` is maintained as a separate repository dependency.

## Stack
- **Frontend:** TypeScript and React 19, bundled with Vite; application code lives primarily in `src/`.
- **Desktop backend:** Rust with Tauri 2 in `src-tauri/`; native commands registered in `src-tauri/src/lib.rs` form the frontend/backend boundary.
- **Agent integration:** `rusty-core` harness engine, referenced through sibling-checkout Cargo path dependencies.
- **Main code areas:** UI in `src/components/`, state slices in `src/store/`, services in `src/services/`, architecture analysis in `src/architecture/`, and native functionality in `src-tauri/src/`.

## Commands
- `npm install` — install frontend dependencies.
- `npm install --prefix ../rusty-core/sdk/typescript` — install the sibling harness SDK dependencies.
- `npm run build:sdk` — build the sibling harness TypeScript SDK.
- `npm run dev` — run the frontend in a browser.
- `npm run tauri dev` — run the desktop app in development.
- `npm run build` — typecheck and build the frontend.
- `npm run tauri build` — build the desktop distribution.
- `npm run test` — run frontend unit tests.
- `npm run test:rust` — run Rust tests for `src-tauri`.
- `npm run typecheck` — typecheck frontend code.
- `npm run typecheck:test` — typecheck test files.
- `npm run verify` — run test typechecking, theme checks, frontend tests, frontend build, and Rust tests.
- `npm run theme:check` — check theme usage.
- `npm run fmt:rust` — check Rust formatting.
- `npm run lint:rust` — run Rust lint.
- **Standalone frontend lint command:** not found.

Tauri builds and Cargo checks require a sibling `rusty-core` checkout at the path expected by `src-tauri/Cargo.toml`. `npm run verify` does not include Rust formatting or lint.

## Conventions
- Frontend state is divided into Zustand slices by product domain and composed in `src/store.ts`.
- UI and service code are grouped mainly by feature under `src/components/`, `src/services/`, `src/store/`, and `src/architecture/`. Native Tauri commands and supporting modules live under `src-tauri/src/`.
- Frontend tests use Vitest and are included from `src/**/*.test.{ts,tsx}`. The default environment is Node; tests that need a DOM opt in per file.
- Tests exist alongside the areas they cover, including architecture modules and native harness modules.
- Native command failures commonly use typed Rust `Result` errors. Some data-loading paths accept absent legacy or optional fields with fallbacks.

## Principles
- **Changes MUST preserve workspace, Git, terminal, file-operation, and repository-analysis paths independently of agent execution, because these are distinct IDE capabilities.**
- **Git file operations MUST validate that paths remain within the repository worktree, because Git actions must not escape that worktree.**
- **Agent session construction MUST retain explicit workspace binding, execution policies, and optional-tool registration boundaries, because these constrain how agent work interacts with the host.**
- **Conversation readers MUST tolerate absent legacy workflow and modified-file metadata, because saved conversations may predate those fields.**
- **Frontend tests MUST run in the configured Node environment unless they explicitly require a DOM, because the test setup isolates frontend state from desktop runtime dependencies.**
