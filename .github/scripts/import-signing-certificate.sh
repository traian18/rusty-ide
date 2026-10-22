#!/usr/bin/env bash
# Imports the Developer ID certificate into a temporary keychain that
# codesign can use without a password prompt. The release workflow deletes
# the keychain again in its last step.
#
# Env: APPLE_CERTIFICATE_P12_BASE64, APPLE_CERTIFICATE_PASSWORD, RUNNER_TEMP.
set -e

KEYCHAIN_PATH="$RUNNER_TEMP/app-signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -base64 24)"
CERT_PATH="$RUNNER_TEMP/cert.p12"

echo -n "$APPLE_CERTIFICATE_P12_BASE64" | base64 --decode -o "$CERT_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERT_PATH" -k "$KEYCHAIN_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security

# Apple's intermediate/root certs are required to build a valid signing
# chain; codesign fails without them present in the signing keychain.
curl -sO https://www.apple.com/certificateauthority/AppleRootCA-G2.cer
curl -sO https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
security import AppleRootCA-G2.cer -k "$KEYCHAIN_PATH"
security import DeveloperIDG2CA.cer -k "$KEYCHAIN_PATH"

# shellcheck disable=SC2046 # the existing keychains are split into separate arguments on purpose
security list-keychains -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | sed 's/"//g')
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security default-keychain -s "$KEYCHAIN_PATH"
