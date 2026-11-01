# Rusty IDE

An AI-assisted coding IDE built with Tauri, React, and TypeScript. Rusty runs a
local agent sidecar that talks to multiple coding-agent backends and
gives them a structured task/reconciliation workflow instead of a single chat
window: delegate work to subagents, watch a live task graph, review generated
diffs, and reconcile results back into your working tree.

## Install

Prebuilt installers for each platform are attached to the
[latest GitHub Release](../../releases/latest). Pick the one for your OS below.
To build from source instead, see [BUILD.md](BUILD.md).

### macOS

Apple Silicon only, for now.

```bash
brew install --cask traian18/rusty/rusty-ide
```

The app is signed with a Developer ID certificate and notarized by Apple.

### Windows

Download the installer from the [latest Release](../../releases/latest) and run it:

- **`Rusty-IDE_<version>_x64-setup.exe`** — NSIS installer (recommended)
- **`Rusty-IDE_<version>_x64_en-US.msi`** — MSI package (for managed/enterprise deploys)

> The Windows builds are **not code-signed**, so SmartScreen shows an
> "unknown publisher" warning on first launch. Click **More info → Run anyway**.

### Linux

Download the package for your distro from the [latest Release](../../releases/latest):

```bash
# Debian / Ubuntu / Mint
sudo apt install ./Rusty-IDE_<version>_amd64.deb

# Fedora / RHEL / openSUSE
sudo dnf install ./Rusty-IDE-<version>-1.x86_64.rpm
```

Then launch from your app menu or run `rusty-ide`.

> An AppImage isn't published — the bundled agent sidecar payload trips the
> AppImage tooling. Build one from source via [BUILD.md](BUILD.md) if you need
> a portable single-file binary.

> **Running under WSLg (WSL2 GUI):** works, but webkit rendering can come up
> blank or slow. If the window is black, force the software/compositing
> fallbacks:
>
> ```bash
> WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 rusty-ide
> ```

## Startup recovery

At launch, Rusty checks the restored window against connected displays before
showing it. An unusable size or unreachable title bar triggers a default-sized
window on an available display. Valid window geometry is retained; fullscreen
is not restored automatically. Window display does not wait for the webview to
finish loading, so the existing configuration and workspace startup checks can
show their progress and recovery controls. Recovery diagnostics are written to
stderr with the `[startup/window]` prefix.

## Workflow handoffs

New workflows use ordinary text or Markdown between agents. Each step receives
its instructions and the selected earlier messages; the final message is passed
on verbatim. The starter's Verify agent reviews the implementation and reports
evidence and remaining work. A finished workflow means the sequence finished,
not that its review approved the implementation.

Workflow budgets, profile turn/tool limits and step timeouts are optional and
unset in the starter. The editor offers numeric limit fields, context checkboxes
and a result-source selector. Existing JSON workflows remain supported through
advanced settings. Rusty bundles twenty workflows and the profiles they use, available in
every project without workspace files. Stage workflows do one part of the job (investigate,
design, diagnose, implement, specify, check changes, security audit, and the spec steps);
end-to-end ones carry a request through (plan-build-verify, bug-fix, refactor, careful-change,
researched-feature, documentation, and others). The Agent's Mode picker lists them. Multi-step
changes (plan-build-verify, researched-feature, careful-change, security-remediation, refactor and
implement-spec) run the approved plan as a task queue, one task at a time. The
workflow folder stores user workflows only. Exact old generated starter files are
removed from that folder; customized copies remain available alongside the built-in.
New Agent chats start in Single agent mode; choose a workflow in the chat when needed.
Agent mode remembers its own selected model across chats and app restarts.

Failed steps save a checkpoint with the conversation. The next message resumes
the failed step, retaining the original request, completed steps and their outputs.
Use **Start over instead** to discard the checkpoint. Resume requires the same
workflow definition; it restarts the failed step and asks the agent to inspect
existing workspace changes before repeating actions. Older conversations without
checkpoints cannot recover completed steps automatically.

Before model requests, Rusty repairs tool history: available results are placed
immediately after their calls, missing outcomes are explicitly marked unknown,
and results whose calls were truncated are retained as text. This also runs after
context assembly, preventing tool-pairing errors without replaying tools.

## What Rusty keeps in a project

Everything Rusty stores for a project lives in its `.rusty` folder: guidelines, specs, skills,
saved workflows and profiles (meant to be committed), and chats, run logs, goals, findings and
metrics (this machine's own, kept out of Git by the folder's `.gitignore`). The folder explains
itself in its own `.rusty/README.md`, which Rusty writes when it creates the folder.

Runs also leave sessions and, for subagents, git worktrees behind. `harness --cleanup` in
`rusty-core` reports the old ones and removes them only after you confirm.

## Development

For how the front end is organised (features, the app shell, shared `lib/`, and the import rules a
test enforces), read [`src/features/README.md`](src/features/README.md).

See [BUILD.md](BUILD.md) for prerequisites and build instructions across
macOS, Windows, and Linux. Colors come from the tokens in
[`src/styles/tokens.css`](src/styles/tokens.css).

```bash
npm install
npm run tauri dev
```
