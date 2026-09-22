# Building Rusty-IDE

## Prerequisites

All platforms need:
- [Node.js](https://nodejs.org/) 20.19+ or 22.12+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- A sibling checkout of [`rusty-core`](https://github.com/traian18/rusty-core) -- the Rust harness
  engine, a separate repo. `src-tauri/Cargo.toml` pulls it in via plain `path =
  "../../rusty-core/..."` Cargo dependencies (RUSTY_CORE_INTEGRATION_PLAN.md's own phased plan is
  still in its first stage: a pinned git/crates.io dependency comes later), so Cargo does **not**
  fetch it -- it has to already exist on disk, checked out next to this repo:
  ```
  some-parent-dir/
    rusty-ide/     <- this repo
    rusty-core/    <- https://github.com/traian18/rusty-core, cloned separately
  ```
  Any `cargo`/`npm run tauri` command fails with an unresolved-path-dependency error if `rusty-core`
  isn't there. CI (`.github/workflows/release*.yml`) checks it out itself as a second, sibling step
  before building, tracking its `main` branch.

### Platform-specific

| Platform | Requirement |
|----------|-------------|
| **macOS** | Xcode Command Line Tools (`xcode-select --install`) |
| **Windows** | [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (MSVC v143 + Windows 10/11 SDK) |
| **Linux** | System libraries (see below) |

#### Linux system libraries

Debian/Ubuntu:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev
```

Fedora:

```bash
sudo dnf install -y webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel openssl-devel
```

Arch Linux:

```bash
sudo pacman -S --needed webkit2gtk-4.1 libappindicator-gtk3 librsvg openssl
```

openSUSE:

```bash
sudo zypper install -y libwebkit2gtk-4_1-0-devel libappindicator3-devel librsvg-devel libopenssl-devel
```

## Install dependencies (first time only)

```bash
npm install
```

> `npm ci` (against the committed lockfiles) is unaffected, but plain
> `npm install` to *add or update* a root dependency can fail on npm 10.9.8
> with `Cannot read properties of null (reading 'edgesOut')` — a known bug in
> that version's peer-dependency resolver, reproducible on this repo's
> dependency graph. If you hit it, run the install with a newer npm instead
> of downgrading anything in this repo: `npx --yes npm@11 install <pkg>`.

## Build the application

The same command works on every platform:

```bash
npm run tauri build
```

This runs three steps automatically:

1. **Harness SDK** — compiles the TypeScript SDK from the sibling `rusty-core` checkout.
2. **Frontend** — typechecks and bundles the React application with Vite.
3. **Tauri** — compiles the Rust app in release mode and bundles the app.

Codex, Claude Code, and GitHub Copilot runtimes are not included in installers.
On first sign-in (or an explicitly started session), Rusty downloads only that
provider’s native package into its app-local data directory under
`managed-runtimes/<provider>/<version>-<platform>-<arch>`. Later launches reuse
that installation. Startup, auth checks, and quota polling never download runtimes.
No system Node.js or npm installation is required. First use needs internet;
failed downloads can be retried by signing in again.

Package URLs and SHA-512 checksums are pinned in
`src-tauri/src/harness/managed-runtime-packages.json`, derived from
`vendor-cli/package-lock.json`. Update both when upgrading the provider versions.
The downloader verifies the checksum before extraction, rejects unsafe archive
entries, and publishes a complete installation with an atomic rename.
Downloaded executables retain their upstream signatures and executable modes.

### Build a specific bundle target

```bash
# macOS — DMG only
npm run tauri build -- --bundles dmg

# Linux — AppImage only
npm run tauri build -- --bundles appimage

# Linux — deb only
npm run tauri build -- --bundles deb

# Linux — rpm only
npm run tauri build -- --bundles rpm

# Windows — NSIS installer only
npm run tauri build -- --bundles nsis

# Windows — MSI only
npm run tauri build -- --bundles msi
```

## Output

### macOS

| Bundle | Path |
|--------|------|
| App bundle | `src-tauri/target/release/bundle/macos/Rusty-IDE.app` |
| DMG | `src-tauri/target/release/bundle/dmg/Rusty-IDE_0.1.0_<arch>.dmg` |

### Windows

| Bundle | Path |
|--------|------|
| NSIS installer | `src-tauri/target/release/bundle/nsis/Rusty-IDE_0.1.0_<arch>-setup.exe` |
| MSI | `src-tauri/target/release/bundle/msi/Rusty-IDE_0.1.0_<arch>.msi` |

### Linux

| Bundle | Path |
|--------|------|
| AppImage | `src-tauri/target/release/bundle/appimage/Rusty-IDE_0.1.0_<arch>.AppImage` |
| Debian | `src-tauri/target/release/bundle/deb/Rusty-IDE_0.1.0_<arch>.deb` |
| RPM | `src-tauri/target/release/bundle/rpm/Rusty-IDE_0.1.0-1.<arch>.rpm` |

> **AppImage** is the most portable single-file option across distributions. **deb** targets Debian/Ubuntu/Mint, **rpm** targets Fedora/RHEL/openSUSE.

## Cross-platform builds via CI

You cannot natively build Windows or Linux binaries from macOS. GitHub Actions builds each platform natively and checks out `rusty-ide` and `rusty-core` as sibling directories before compiling. A version tag triggers only `.github/workflows/release.yml`, the signed and notarized Apple Silicon macOS release. Windows and Linux builds remain available through manual `workflow_dispatch` runs in `release-windows.yml` and `release-linux.yml`; they do not run for tags yet. Provider runtimes are downloaded only by users who need them.

## Development

```bash
npm run tauri dev
```

Runs the frontend (Vite, HMR) and the Rust app together. Every capability
runs on the embedded Rust engine (`rusty-core`) directly -- there is no
separate sidecar process to spawn or hot-reload.

## Running the test suite

```bash
npm run verify
```

Runs, in order: frontend test typecheck, frontend unit tests (vitest),
frontend production build (`tsc && vite build`), and Rust tests. All of it
works from a clean clone with plain `npm install`.

Per-layer scripts, if you only need one piece:

```bash
npm run test              # frontend unit tests (vitest)
npm run test:watch        # frontend unit tests, watch mode
npm run typecheck:test    # typecheck test files (kept off the release tsc)
npm run test:rust         # cargo test (src-tauri)
```

`npm run fmt:rust` (`cargo fmt --check`) and `npm run lint:rust`
(`cargo clippy -D warnings`) also exist but are **not** part of `verify` or
any CI gate yet — `src-tauri/src/git.rs` has never been formatted, and
reformatting it now would produce a large mechanical diff that conflicts
with `REFACTOR_PLAN.md` PR 5's rewrite of the same file. Enforcement is
deferred to a dedicated formatting PR sequenced after PR 5.

### Stale Rust build artifacts

If `cargo check`/`cargo build` fails with an error like:

```
failed to read plugin permissions: failed to read file
'/some/other/checkout/src-tauri/target/debug/build/.../out/permissions/...':
No such file or directory (os error 2)
```

`src-tauri/target/` was copied or moved from a different checkout rather than
built in place — Cargo's build-script output caches absolute paths from
wherever it was originally built. Both `src-tauri/target/` and
`src-tauri/gen/schemas/` are gitignored and fully regenerable, so the fix is:

```bash
rm -rf src-tauri/target
cargo check --manifest-path src-tauri/Cargo.toml
```

### Managed runtime troubleshooting

Builds and Rust checks no longer need `src-tauri/resources/managed-cli/`.
Old generated resources may be deleted; even if present, they are neither
bundled nor used by the app.

If an installed runtime becomes corrupt, close the app and remove only that
provider’s version directory under the app-local `managed-runtimes` directory.
Sign in again to download and verify a fresh copy. Downloads do not alter system
CLI installations or provider credentials.
