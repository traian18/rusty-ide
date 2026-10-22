#!/usr/bin/env bash
# Writes latest.json, the manifest the in-app updater reads, for the
# updater archive `tauri build` left in the bundle directory, and exports
# UPDATER_ARCHIVE for the release step.
#
# Usage: write-updater-manifest.sh <bundle-dir> <platform>   (e.g. darwin-aarch64)
# Env: GITHUB_REPOSITORY, GITHUB_REF_NAME (the release tag), GITHUB_ENV.
set -e

BUNDLE_DIR="$1"
PLATFORM="$2"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"

# Named by product name, not hardcoded here, since the exact
# updater-artifact filename is the bundler's own convention --
# discovering it by glob keeps this step correct even if that
# convention shifts across tauri-cli versions.
ARCHIVE="$(find "$BUNDLE_DIR" -maxdepth 1 -name '*.tar.gz' | head -n1)"
if [ -z "$ARCHIVE" ]; then
  echo "No updater .app.tar.gz found in $BUNDLE_DIR -- is createUpdaterArtifacts set in tauri.conf.json and TAURI_SIGNING_PRIVATE_KEY set?" >&2
  exit 1
fi
SIG_FILE="${ARCHIVE}.sig"
SIGNATURE="$(cat "$SIG_FILE")"
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > latest.json <<EOF
{
  "version": "$VERSION",
  "notes": "See the GitHub release for details: https://github.com/${GITHUB_REPOSITORY}/releases/tag/${GITHUB_REF_NAME}",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "$PLATFORM": {
      "signature": "$SIGNATURE",
      "url": "https://github.com/${GITHUB_REPOSITORY}/releases/download/${GITHUB_REF_NAME}/$(basename "$ARCHIVE")"
    }
  }
}
EOF

echo "UPDATER_ARCHIVE=$ARCHIVE" >> "$GITHUB_ENV"
