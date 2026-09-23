# Releasing Rusty-IDE

Publishing a new version is a single tag push. Everything else — build,
codesign, notarization, GitHub release, Homebrew tap update — happens in CI.

## Steps

1. Bump `"version"` in `src-tauri/tauri.conf.json`.
2. Commit it to `main`.
3. Tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The tag format must match `v*.*.*` (e.g. `v0.1.4`) — that's what triggers
`.github/workflows/release.yml`.

## What CI does

The `Release macOS` workflow (`macos-14`, Apple Silicon) is the only workflow
that runs on a matching tag push. Windows and Linux packaging workflows are
retained as manual actions while those platforms remain unverified.

1. Checks out `rusty-ide` and `rusty-core` as sibling directories, then
   installs the locked frontend dependencies.
2. Imports the Developer ID Application certificate into a throwaway
   keychain.
3. Runs `npm run tauri build -- --bundles app`, which builds the frontend,
   compiles the IDE against the sibling harness checkout, then signs and
   notarizes the `.app` with Apple. Because `createUpdaterArtifacts: true`
   is set in `tauri.conf.json` and `TAURI_SIGNING_PRIVATE_KEY` is exported
   for this step, the same build also emits a signed `.app.tar.gz` + `.sig`
   pair for the in-app updater (see "In-app updates" below).
4. Packages the notarized app into a DMG and signs the DMG itself.
5. Verifies the result (`stapler validate`, `spctl -a`) before publishing
   anything.
6. Builds `latest.json` (the updater manifest the running app polls) from
   the updater archive's `.sig` file.
7. Creates a GitHub release for the tag with the DMG, the updater archive,
   and `latest.json` attached.
8. Clones the [Homebrew tap](https://github.com/traian18/homebrew-rusty) and
   updates `Casks/rusty-ide.rb`'s `version` and `sha256` to match.

## In-app updates

Rusty checks `https://github.com/traian18/rusty-ide/releases/latest/download/latest.json`
on startup (in the background, non-blocking) and from Settings → Software
Update, via Tauri's updater plugin (`src/store/slices/createUpdateSlice.ts`).
"Update Now" downloads and installs the signed `.app.tar.gz` from the
matching release and relaunches the app -- no `brew upgrade` needed, though
that still works for anyone who prefers it.

The updater verifies every downloaded artifact against the public key baked
into `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The matching
private key only exists as the `TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets below -- **losing it means
generating a new keypair and shipping a build with the new pubkey that every
existing install has to pick up manually** (old installs can't verify
updates signed by a key they don't recognize), so treat it like the Apple
signing cert: back it up somewhere durable outside GitHub Secrets.

Takes roughly 15–20 minutes end to end (mostly the Rust compile and Apple's
notarization queue).

## Watching a release

```bash
gh run list --repo traian18/rusty-ide --limit 3
gh run watch <run-id> --repo traian18/rusty-ide --exit-status
```

When it finishes, confirm:

```bash
gh release view vX.Y.Z --repo traian18/rusty-ide
```

## If a run fails partway through

If it fails **before** the "Create GitHub release" step, no release/tag
artifacts were published — it's safe to fix the issue, delete, and re-push
the same tag:

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
git tag vX.Y.Z
git push origin vX.Y.Z
```

If it already reached "Create GitHub release" or "Update Homebrew tap",
check `gh release view vX.Y.Z --repo traian18/rusty-ide` first — don't re-tag
over a real published release. Bump to the next patch version instead.

## Secrets involved (traian18/rusty-ide repo settings → Secrets and variables → Actions)

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` / `APPLE_CERTIFICATE_PASSWORD` | Developer ID Application cert + key, base64-encoded `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Suciu Victor Traian (XH3PAKPS6T)` |
| `APPLE_API_ISSUER` / `APPLE_API_KEY_ID` / `APPLE_API_KEY_P8` | App Store Connect API key used by `notarytool` |
| `HOMEBREW_TAP_TOKEN` | Currently your personal `gh` OAuth token (has `repo` scope) — used to push the version/sha256 bump to `homebrew-rusty`. If you ever revoke/rotate your local `gh auth login` session, regenerate this secret from a fresh `gh auth token`. |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signs the in-app updater's `.app.tar.gz` artifact. Generate with `npx tauri signer generate -w /path/outside/the/repo/rusty-ide-updater.key`; put the resulting private key string in the first secret and its password in the second, then copy the printed public key into `src-tauri/tauri.conf.json`'s `plugins.updater.pubkey`. Never commit the private key. |

## Updating the installed app (for you or any user)

```bash
brew upgrade --cask rusty-ide
```

`brew update` on its own only refreshes tap metadata — it doesn't install
anything. `brew upgrade` is what actually pulls and installs a newer
version, and it auto-refreshes tap data first by default, so this one
command is enough.

## Known limitations

- **Apple Silicon (`aarch64`) only.** No Intel build yet — would need an
  `x86_64` macOS runner added to the workflow matrix, plus a second
  `sha256`/`url`/`depends_on arch:` pair in the cask.
- Building locally (outside CI) needs `APPLE_SIGNING_IDENTITY` exported and
  the Developer ID cert + notarization API key present on that machine —
  see the "Import Developer ID certificate" / "Write notarization API key"
  steps in `.github/workflows/release.yml` for what CI does that a local
  shell would need to replicate manually.
